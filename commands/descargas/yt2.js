import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://nexevo.onrender.com/download/y2";

const COOLDOWN_TIME = 15 * 1000;
const DEFAULT_QUALITY = "360p";

const TMP_DIR = path.join(process.cwd(), "tmp");

// límites
const MAX_VIDEO_BYTES = 70 * 1024 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 350 * 1024 * 1024;
const MIN_VALID_BYTES = 300000;
const CLEANUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const cooldowns = new Map();
const locks = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function safeFileName(name) {
  return (String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "video");
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function getYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
    const v = u.searchParams.get("v");
    if (v) return v.trim();
    return null;
  } catch {
    return null;
  }
}

// limpieza automática
function cleanupTmp(maxAgeMs = CLEANUP_MAX_AGE_MS) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (now - st.mtimeMs) > maxAgeMs) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

// espacio libre
function getFreeBytes(dir) {
  try {
    const out = execSync(`df -k "${dir}" | tail -1 | awk '{print $4}'`).toString().trim();
    const freeKb = Number(out);
    return Number.isFinite(freeKb) ? freeKb * 1024 : null;
  } catch {
    return null;
  }
}

// -------- API NEXEVO 360p --------
async function fetchDirectMediaUrl({ videoUrl }) {
  const { data } = await axios.get(API_URL, {
    timeout: 25000,
    params: { url: videoUrl }, // 360p por defecto
  });

  if (!data?.status || !data?.result?.url) {
    throw new Error("API Nexevo inválida o sin URL directa.");
  }

  return {
    title: data?.result?.info?.title || "video",
    directUrl: data.result.url,
    thumbnail: data?.result?.info?.thumbnail || null,
  };
}

async function resolveVideoInfo(queryOrUrl) {
  if (!isHttpUrl(queryOrUrl)) {
    const search = await yts(queryOrUrl);
    const first = search?.videos?.[0];
    if (!first) return null;
    return {
      videoUrl: first.url,
      title: safeFileName(first.title),
      thumbnail: first.thumbnail || null
    };
  }

  const vid = getYoutubeId(queryOrUrl);
  if (vid) {
    try {
      const info = await yts({ videoId: vid });
      if (info)
        return {
          videoUrl: info.url || queryOrUrl,
          title: safeFileName(info.title),
          thumbnail: info.thumbnail || null
        };
    } catch {}
  }

  return { videoUrl: queryOrUrl, title: "video", thumbnail: null };
}

async function headContentLength(url) {
  try {
    const r = await axios.head(url, { timeout: 15000, maxRedirects: 5 });
    const len = Number(r.headers["content-length"]);
    return Number.isFinite(len) ? len : null;
  } catch {
    return null;
  }
}

// enviar por URL primero
async function trySendByUrl(sock, from, quoted, directUrl, title) {
  try {
    await sock.sendMessage(from, {
      video: { url: directUrl },
      mimetype: "video/mp4",
      caption: `🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
    return "video-url";
  } catch {
    await sock.sendMessage(from, {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: `${title}.mp4`,
      caption: `📄 Enviado como documento\n🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
    return "doc-url";
  }
}

// descarga controlada
async function downloadToFileWithLimit(directUrl, outPath, maxBytes) {
  const partPath = `${outPath}.part`;
  let downloaded = 0;

  const res = await axios.get(directUrl, {
    responseType: "stream",
    timeout: 120000,
  });

  const writer = fs.createWriteStream(partPath);

  res.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > maxBytes) {
      res.data.destroy(new Error("Archivo supera el límite"));
    }
  });

  await new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const size = fs.statSync(partPath).size;
  if (size < MIN_VALID_BYTES) throw new Error("Archivo inválido");

  fs.renameSync(partPath, outPath);
  return size;
}

async function sendByFile(sock, from, quoted, filePath, title, size) {
  if (size <= MAX_VIDEO_BYTES) {
    await sock.sendMessage(from, {
      video: { url: filePath },
      mimetype: "video/mp4",
      caption: `🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
  } else {
    await sock.sendMessage(from, {
      document: { url: filePath },
      mimetype: "video/mp4",
      fileName: `${title}.mp4`,
      caption: `📄 Enviado como documento\n🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
  }
}

export default {
  command: ["yt2"], // 🔥 SOLO yt2
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const userId = from;

    if (locks.has(from))
      return sock.sendMessage(from, { text: "⏳ Ya estoy procesando otro video aquí." });

    const until = cooldowns.get(userId);
    if (until && until > Date.now())
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
      });

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);
    const quoted = msg?.key ? { quoted: msg } : undefined;

    let outFile = null;

    try {
      locks.add(from);
      cleanupTmp();

      if (!args?.length)
        return sock.sendMessage(from, { text: "❌ Uso: .yt2 <nombre o link>" });

      const query = args.join(" ").trim();
      const meta = await resolveVideoInfo(query);
      if (!meta) throw new Error("No se encontró el video.");

      let { videoUrl, title, thumbnail } = meta;

      if (thumbnail) {
        await sock.sendMessage(from, {
          image: { url: thumbnail },
          caption: `⬇️ Procesando...\n\n🎬 ${title}\n🎚️ Calidad: 360p`,
        }, quoted);
      }

      const info = await fetchDirectMediaUrl({ videoUrl });
      title = safeFileName(info.title || title);

      const len = await headContentLength(info.directUrl);
      if (len && len > MAX_DOC_BYTES)
        throw new Error("❌ Archivo supera 2GB.");

      const free = getFreeBytes(TMP_DIR);
      if (free != null && free < MIN_FREE_BYTES) {
        await trySendByUrl(sock, from, quoted, info.directUrl, title);
        return;
      }

      try {
        await trySendByUrl(sock, from, quoted, info.directUrl, title);
        return;
      } catch {}

      outFile = path.join(TMP_DIR, `${Date.now()}.mp4`);
      const size = await downloadToFileWithLimit(info.directUrl, outFile, MAX_DOC_BYTES);
      await sendByFile(sock, from, quoted, outFile, title, size);

    } catch (err) {
      cooldowns.delete(userId);
      await sock.sendMessage(from, { text: `❌ ${err.message}` });
    } finally {
      locks.delete(from);
      try { if (outFile && fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
    }
  },
};