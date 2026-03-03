import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://nexevo.onrender.com/download/y2";

const COOLDOWN_TIME = 15 * 1000;
const TMP_DIR = path.join(process.cwd(), "tmp");

const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // 🔥 150MB video normal
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_VALID_BYTES = 300000;

const cooldowns = new Map();
const locks = new Set();

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

async function resolveVideoInfo(queryOrUrl) {
  if (!isHttpUrl(queryOrUrl)) {
    const search = await yts(queryOrUrl);
    const first = search?.videos?.[0];
    if (!first) return null;
    return { videoUrl: first.url, title: first.title };
  }
  return { videoUrl: queryOrUrl, title: "video" };
}

async function fetchDirectMediaUrl(videoUrl) {
  const { data } = await axios.get(API_URL, {
    timeout: 25000,
    params: { url: videoUrl },
  });

  if (!data?.status || !data?.result?.url) {
    throw new Error("API no respondió correctamente.");
  }

  return {
    title: data?.result?.info?.title || "video",
    directUrl: data.result.url,
    thumbnail: data?.result?.info?.thumbnail || null,
    quality: data?.result?.quality || 360,
  };
}

async function headSize(url) {
  try {
    const r = await axios.head(url, { timeout: 15000 });
    const len = Number(r.headers["content-length"]);
    return Number.isFinite(len) ? len : null;
  } catch {
    return null;
  }
}

async function downloadToFile(url, filePath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
  });

  const writer = fs.createWriteStream(filePath);

  await new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const size = fs.statSync(filePath).size;
  if (size < MIN_VALID_BYTES) throw new Error("Archivo inválido");
  return size;
}

export default {
  command: ["ytmp4", "yt2"], // 🔥 nuevo comando agregado
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const quoted = ctx.m ? { quoted: ctx.m } : undefined;

    if (locks.has(from))
      return sock.sendMessage(from, { text: "⏳ Espera que termine el proceso actual." });

    const until = cooldowns.get(from);
    if (until && until > Date.now())
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((until - Date.now()) / 1000)}s`,
      });

    if (!args?.length)
      return sock.sendMessage(from, { text: "❌ Uso: .yt2 <nombre o link>" });

    cooldowns.set(from, Date.now() + COOLDOWN_TIME);
    locks.add(from);

    let outFile = null;

    try {
      const query = args.join(" ");
      const meta = await resolveVideoInfo(query);
      if (!meta) throw new Error("No se encontró el video.");

      const api = await fetchDirectMediaUrl(meta.videoUrl);
      const title = safeFileName(api.title || meta.title);

      const design = `
┏━━━━━━━━━━━━━━━━━━
┃ 🎥  DVYER • VIDEO
┣━━━━━━━━━━━━━━━━━━
┃ 📌 ${title}
┃ ⚙️ ${api.quality}p
┃ 🚀 Descargando...
┗━━━━━━━━━━━━━━━━━━
`;

      if (api.thumbnail) {
        await sock.sendMessage(from, {
          image: { url: api.thumbnail },
          caption: design,
        }, quoted);
      } else {
        await sock.sendMessage(from, { text: design }, quoted);
      }

      const size = await headSize(api.directUrl);

      // 🔥 Si el server informa tamaño y es menor a 150MB
      if (size && size <= MAX_VIDEO_BYTES) {
        await sock.sendMessage(from, {
          video: { url: api.directUrl },
          mimetype: "video/mp4",
          caption: `🎬 ${title}`,
        }, quoted);
      } else {
        // Intentar video normal igual
        try {
          await sock.sendMessage(from, {
            video: { url: api.directUrl },
            mimetype: "video/mp4",
            caption: `🎬 ${title}`,
          }, quoted);
        } catch {
          // 🔥 Si falla → documento
          await sock.sendMessage(from, {
            document: { url: api.directUrl },
            mimetype: "video/mp4",
            fileName: `${title}.mp4`,
            caption: `📁 ${title}`,
          }, quoted);
        }
      }

    } catch (err) {
      await sock.sendMessage(from, { text: `❌ ${err.message}` });
    } finally {
      locks.delete(from);
      if (outFile && fs.existsSync(outFile)) {
        try { fs.unlinkSync(outFile); } catch {}
      }
    }
  },
};