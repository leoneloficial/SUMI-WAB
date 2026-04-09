import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { buildDvyerUrl, getDvyerBaseUrl } from "../../lib/api-manager.js";
import { throwIfAborted } from "../../lib/command-abort.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const API_BASE = getDvyerBaseUrl();
const API_MP3_URL = buildDvyerUrl("/ytmp3");
const API_SEARCH_URL = buildDvyerUrl("/ytsearch");
const TMP_DIR = path.join(os.tmpdir(), "dvyer-ytmp3");
const AUDIO_QUALITY = "128k";
const REQUEST_TIMEOUT = 420000;
const LOCAL_AUDIO_TIMEOUT = 420000;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const AUDIO_AS_DOCUMENT_THRESHOLD = 60 * 1024 * 1024;
const LINK_RETRY_ATTEMPTS = 4;
const COOLDOWN_TIME = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SEND_RETRY_ATTEMPTS = 2;
const AUDIO_SEARCH_LIMIT = 5;
const FFMPEG_TIMEOUT_MS = 300000;
const AUDIO_MIME_BY_EXTENSION = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
};

const cooldowns = new Map();
const cache = new Map();

function now() {
  return Date.now();
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { value, expiresAt: now() + ttlMs });
}

function safeName(value, fallback = "audio") {
  const clean = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function ensureTmpDir() {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  } catch {}
}

function deleteFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function cleanExtension(value, fallback = "mp3") {
  const ext = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return AUDIO_MIME_BY_EXTENSION[ext] ? ext : fallback;
}

function normalizeAudioFileName(name, fallbackBase = "audio", fallbackExt = "mp3") {
  const parsed = path.parse(String(name || "").trim());
  const ext = cleanExtension(parsed.ext.replace(/^\./, ""), fallbackExt);
  const base = safeName(parsed.name || fallbackBase, fallbackBase);
  return `${base}.${ext}`;
}

function displayTitle(value, fallback = "audio") {
  const clean = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

function buildStatusText({ title, quality, state }) {
  return [
    "╭─〔 *𝑫𝑽𝒀𝑬𝑹 • 𝑴𝑷𝟑* 〕",
    `┃ ♬ *Título:* ${displayTitle(title, "audio")}`,
    `┃ ⌁ *Calidad:* ${quality}`,
    `┃ ◈ *Estado:* ${state}`,
    "╰─⟡ _Preparando metadata original..._",
  ].join("\n");
}

function buildReadyCaption({ title, quality, format }) {
  return [
    "╭─〔 *𝑫𝑽𝒀𝑬𝑹 • 𝑨𝑼𝑫𝑰𝑶* 〕",
    `┃ ♬ *${displayTitle(title, "audio")}*`,
    `┃ ⌁ *Calidad:* ${quality} • ${format || "MP3"}`,
    "╰─⟡ _Archivo listo_",
  ].join("\n");
}

function buildMediaContext({ title, body, thumbnail, sourceUrl }) {
  const channelContext = global.channelInfo?.contextInfo || {};
  const externalAdReply = {
    title: displayTitle(title, "audio"),
    body: body || "DVYER MP3 • descarga directa",
    mediaType: 2,
    sourceUrl: sourceUrl || "https://dv-yer-api.online",
    renderLargerThumbnail: false,
    showAdAttribution: false,
  };
  if (thumbnail) {
    externalAdReply.thumbnailUrl = thumbnail;
  }
  return {
    ...channelContext,
    externalAdReply,
  };
}

function withChannelInfo(content, contextInfo = null) {
  const base = global.channelInfo || {};
  const mergedContext = {
    ...(base.contextInfo || {}),
    ...(contextInfo || {}),
  };
  return {
    ...content,
    ...base,
    ...(Object.keys(mergedContext).length ? { contextInfo: mergedContext } : {}),
  };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function extractTextFromAnyMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  );
}

function resolveInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quoted =
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null;
  const quotedText = extractTextFromAnyMessage(quoted);
  return argsText || quotedText || "";
}

function parseDeliveryModeAndInput(rawInput) {
  let query = String(rawInput || "").trim();
  let deliveryMode = "file";
  const flagMatch = query.match(/--?(stream|streaming|file|direct|download|descarga)\b/i);
  if (flagMatch) {
    const value = flagMatch[1].toLowerCase();
    deliveryMode = value.startsWith("stream") ? "stream" : "file";
    query = query.replace(flagMatch[0], " ").replace(/\s+/g, " ").trim();
  }
  const [firstToken, ...rest] = query.split(/\s+/);
  const modeToken = String(firstToken || "").toLowerCase();
  if (["stream", "streaming", "file", "direct", "download", "descarga"].includes(modeToken)) {
    deliveryMode = modeToken.startsWith("stream") ? "stream" : "file";
    query = rest.join(" ").trim();
  }
  return { query, deliveryMode };
}

function normalizeApiUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (isHttpUrl(value)) return value;
  if (value.startsWith("/")) return `${API_BASE}${value}`;
  return `${API_BASE}/${value}`;
}

function normalizeAudioExtension(payload) {
  const fromFormat = String(payload?.format || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const fromFile = String(payload?.filename || payload?.fileName || "")
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]{2,5})(?:$|\?)/)?.[1];
  const ext = fromFile || fromFormat || "mp3";
  if (ext === "mpeg") return "mp3";
  if (ext === "mp4") return "m4a";
  return AUDIO_MIME_BY_EXTENSION[ext] ? ext : "mp3";
}

function audioMimeFromExtension(extension) {
  return AUDIO_MIME_BY_EXTENSION[String(extension || "").toLowerCase()] || "audio/mpeg";
}

function extensionFromMime(mimetype = "") {
  const value = String(mimetype || "").toLowerCase();
  if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("webm")) return "webm";
  if (value.includes("ogg") || value.includes("opus")) return "ogg";
  return "mp3";
}

function detectAudioFormat(filePath, fallbackExt = "mp3") {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const head = buffer.subarray(0, bytesRead);
    if (head.length >= 3 && head.subarray(0, 3).toString("ascii") === "ID3") {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }
    if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }
    if (head.length >= 8 && head.subarray(4, 8).toString("ascii") === "ftyp") {
      return { ext: "m4a", mimetype: "audio/mp4", isMp3: false };
    }
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      return { ext: "webm", mimetype: "audio/webm", isMp3: false };
    }
  } catch {}
  const ext = cleanExtension(fallbackExt, "mp3");
  return { ext, mimetype: audioMimeFromExtension(ext), isMp3: ext === "mp3" };
}

function parseFileNameFromDisposition(value = "") {
  const header = String(value || "");
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/["']/g, ""));
    } catch {
      return encoded.replace(/["']/g, "");
    }
  }
  return header.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

function buildApiMp3FileUrl(videoUrl) {
  const target = new URL(API_MP3_URL);
  target.searchParams.set("mode", "file");
  target.searchParams.set("url", videoUrl);
  target.searchParams.set("quality", AUDIO_QUALITY);
  return target.toString();
}

function pickDownloadUrl(payload) {
  return (
    payload?.direct_url_full ||
    payload?.direct_url ||
    payload?.download_url_full ||
    payload?.stream_url_full ||
    payload?.download_url ||
    payload?.stream_url ||
    payload?.url ||
    payload?.result?.direct_url_full ||
    payload?.result?.direct_url ||
    payload?.result?.download_url_full ||
    payload?.result?.stream_url_full ||
    payload?.result?.download_url ||
    payload?.result?.stream_url ||
    payload?.result?.url ||
    ""
  );
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

function hideProviderText(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[internal]")
    .replace(/yt1s/gi, "internal")
    .replace(/ytdown/gi, "internal")
    .replace(/ytdlp/gi, "internal")
    .replace(/ytmp3tube/gi, "internal")
    .replace(/mp3now/gi, "internal")
    .trim();
}

function shouldRetryError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("rate-overlimit") ||
    text.includes("rate overlimit") ||
    text.includes("overlimit") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("socket hang up") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("410") ||
    text.includes("expired") ||
    text.includes("expirado") ||
    text.includes("invalido") ||
    text.includes("invalid") ||
    text.includes("service unavailable") ||
    text.includes("temporarily") ||
    text.includes("media unavailable") ||
    text.includes("internal")
  );
}

function isExpiredLinkError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("410") ||
    text.includes("expired") ||
    text.includes("expirado") ||
    text.includes("link invalido") ||
    text.includes("invalid link") ||
    text.includes("not available")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(url, params, signal) {
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT,
    params,
    signal: signal || undefined,
    validateStatus: () => true,
  });

  if (response.status >= 400 || response?.data?.ok === false || response?.data?.status === false) {
    throw new Error(extractApiError(response.data, response.status));
  }

  return response.data;
}

async function readStreamText(stream, limit = 1200) {
  return new Promise((resolve) => {
    let text = "";
    stream?.on?.("data", (chunk) => {
      if (text.length < limit) {
        text += Buffer.from(chunk).toString("utf-8");
      }
    });
    stream?.on?.("end", () => resolve(text.slice(0, limit)));
    stream?.on?.("error", () => resolve(text.slice(0, limit)));
  });
}

async function downloadAudioFile(downloadUrl, { fileName, title, signal }) {
  ensureTmpDir();
  const response = await axios.get(downloadUrl, {
    timeout: LOCAL_AUDIO_TIMEOUT,
    responseType: "stream",
    signal: signal || undefined,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "audio/mpeg,audio/mp4,audio/*,*/*",
    },
  });

  if (response.status >= 400) {
    const detail = hideProviderText(await readStreamText(response.data));
    throw new Error(detail || `HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength && contentLength > MAX_AUDIO_BYTES) {
    throw new Error("El audio es demasiado grande para enviarlo directo.");
  }

  const headerName = parseFileNameFromDisposition(response.headers?.["content-disposition"]);
  const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
  const fallbackExt = extensionFromMime(contentType);
  const normalizedName = normalizeAudioFileName(headerName || fileName, safeName(title, "audio"), fallbackExt);
  const outputPath = path.join(TMP_DIR, `${Date.now()}-${randomUUID()}-${normalizedName}`);
  const outputStream = fs.createWriteStream(outputPath);
  let downloaded = 0;

  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_AUDIO_BYTES) {
      response.data.destroy(new Error("El audio es demasiado grande para enviarlo directo."));
    }
  });

  try {
    await pipeline(response.data, outputStream);
  } catch (error) {
    deleteFileSafe(outputPath);
    throw error;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el audio temporal.");
  }
  const size = fs.statSync(outputPath).size;
  if (!size || size < 1024) {
    deleteFileSafe(outputPath);
    throw new Error("El audio llego vacio o incompleto.");
  }
  if (size > MAX_AUDIO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El audio es demasiado grande para enviarlo directo.");
  }

  const format = detectAudioFormat(outputPath, path.extname(normalizedName).replace(".", "") || fallbackExt);
  return {
    filePath: outputPath,
    size,
    fileName: normalizeAudioFileName(normalizedName, safeName(title, "audio"), format.ext),
    mimetype: format.mimetype,
    format: format.ext.toUpperCase(),
    isMp3: format.isMp3,
  };
}

async function convertAudioToMp3(inputPath, title, signal) {
  ensureTmpDir();
  const outputName = `${safeName(title, "audio")}.mp3`;
  const outputPath = path.join(TMP_DIR, `${Date.now()}-${randomUUID()}-${outputName}`);

  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      AUDIO_QUALITY,
      "-ar",
      "44100",
      outputPath,
    ]);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
      deleteFileSafe(outputPath);
      finish(null);
    };
    const timer = setTimeout(() => {
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
      deleteFileSafe(outputPath);
      finish(null);
    }, FFMPEG_TIMEOUT_MS);

    signal?.addEventListener?.("abort", onAbort, { once: true });
    ffmpeg.on("error", () => {
      deleteFileSafe(outputPath);
      finish(null);
    });
    ffmpeg.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        deleteFileSafe(outputPath);
        finish(null);
        return;
      }
      const size = fs.statSync(outputPath).size;
      if (!size) {
        deleteFileSafe(outputPath);
        finish(null);
        return;
      }
      finish({
        filePath: outputPath,
        size,
        fileName: outputName,
        mimetype: "audio/mpeg",
        format: "MP3",
        isMp3: true,
      });
    });
  });
}

async function prepareLocalAudio(mp3, signal) {
  const sourceUrl = mp3.localFileUrl || mp3.downloadUrl;
  const downloaded = await downloadAudioFile(sourceUrl, {
    fileName: mp3.fileName,
    title: mp3.title,
    signal,
  });
  const cleanupPaths = [downloaded.filePath];
  let finalAudio = downloaded;

  if (!downloaded.isMp3) {
    const converted = await convertAudioToMp3(downloaded.filePath, mp3.title, signal);
    if (converted) {
      cleanupPaths.push(converted.filePath);
      finalAudio = converted;
    }
  }

  return {
    ...finalAudio,
    cleanupPaths,
  };
}

async function resolveAudioCandidates(rawInput, signal) {
  const videoUrl = extractYouTubeUrl(rawInput);
  if (videoUrl) {
    return [{ videoUrl, title: "audio", thumbnail: null }];
  }

  if (isHttpUrl(rawInput)) {
    throw new Error("Enviame un link valido de YouTube.");
  }

  const query = String(rawInput || "").trim().toLowerCase();
  const cacheKey = `ytsearch:${query}:${AUDIO_SEARCH_LIMIT}`;
  const cached = readCache(cacheKey);
  if (Array.isArray(cached) && cached.length) {
    return cached;
  }

  const search = await apiGet(API_SEARCH_URL, { q: rawInput, limit: AUDIO_SEARCH_LIMIT }, signal);
  const results = Array.isArray(search?.results) ? search.results : [];
  const candidates = results
    .filter((item) => item?.url)
    .map((item) => ({
      videoUrl: String(item.url).trim(),
      title: displayTitle(item.title || "audio"),
      thumbnail: item.thumbnail || null,
    }));

  if (!candidates.length) {
    throw new Error("No encontre resultados para ese titulo.");
  }

  writeCache(cacheKey, candidates);
  return candidates;
}

async function resolveMp3Link(videoUrl, signal, preferredTitle = "") {
  let payload = null;
  let lastError = null;
  for (let attempt = 1; attempt <= LINK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      payload = await apiGet(
        API_MP3_URL,
        {
          mode: "link",
          url: videoUrl,
          quality: AUDIO_QUALITY,
        },
        signal
      );
      break;
    } catch (error) {
      lastError = error;
      if (!shouldRetryError(error) || attempt >= LINK_RETRY_ATTEMPTS) {
        throw error;
      }
      await sleep(1100 * attempt);
    }
  }
  if (!payload) {
    throw lastError || new Error("No se pudo resolver el audio.");
  }

  const downloadUrl = normalizeApiUrl(pickDownloadUrl(payload));
  if (!downloadUrl) {
    throw new Error("No se pudo resolver el enlace de audio.");
  }

  const extension = normalizeAudioExtension(payload);
  const cleanedTitle = safeName(payload?.title || preferredTitle || "audio");
  const fileBase = safeName(
    String(cleanedTitle || "audio").replace(/\.[^.]+$/i, ""),
    "audio"
  );
  const result = {
    downloadUrl,
    localFileUrl: buildApiMp3FileUrl(videoUrl),
    title: displayTitle(payload?.title || preferredTitle || cleanedTitle, cleanedTitle),
    fileName: `${fileBase}.${extension}`,
    thumbnail: payload?.thumbnail || payload?.image || null,
    quality: String(payload?.quality || AUDIO_QUALITY).trim() || AUDIO_QUALITY,
    format: extension.toUpperCase(),
    mimetype: audioMimeFromExtension(extension),
  };
  return result;
}

async function resolveFirstWorkingAudio(candidates, signal) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const audio = await resolveMp3Link(candidate.videoUrl, signal, candidate.title);
      return { video: candidate, audio };
    } catch (error) {
      lastError = error;
      if (!shouldRetryError(error)) {
        continue;
      }
      await sleep(450);
    }
  }
  throw lastError || new Error(`No encontre audio estable despues de probar ${candidates.length} resultados.`);
}

function toFriendlyError(error) {
  const text = hideProviderText(error?.message || error || "");
  const low = text.toLowerCase();
  if (low.includes("demasiado grande")) {
    return "El archivo es muy grande para enviarlo directo.";
  }
  if (low.includes("rate-overlimit") || low.includes("rate overlimit") || low.includes("overlimit")) {
    return "El proveedor esta saturado ahora. Reintenta en 15-30 segundos.";
  }
  if (low.includes("timeout") || low.includes("timed out") || low.includes("socket hang up")) {
    return "El servidor tardo demasiado. Intenta de nuevo.";
  }
  if (low.includes("429") || low.includes("too many requests")) {
    return "Hay muchas solicitudes ahora. Intenta en unos segundos.";
  }
  if (low.includes("no se pudo preparar la descarga de audio")) {
    return "No encontre un audio estable para ese resultado. Intenta con el link exacto o escribe artista + cancion.";
  }
  if (low.includes("410") || low.includes("expirado") || low.includes("expired")) {
    return "El enlace temporal expiro mientras WhatsApp lo abria. Reintenta y se generara uno nuevo.";
  }
  if (low.includes("media unavailable")) {
    return "Ese audio no esta disponible ahora mismo. Prueba en unos segundos o con otro video.";
  }
  return text || "Error al procesar el audio.";
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - now()) / 1000));
}

async function sendAudioFast(sock, from, quoted, { downloadUrl, localFileUrl, fileName, title, thumbnail, videoUrl, mimetype, quality, format, signal, deliveryMode = "file" }) {
  let lastError = null;
  const cleanTitle = displayTitle(title, "audio");
  const cleanQuality = quality || AUDIO_QUALITY;
  const streamMime = mimetype || "audio/mpeg";
  const streamFormat = format || "MP3";
  const metadata = buildMediaContext({
    title: cleanTitle,
    body: `MP3 • ${cleanQuality} • DVYER`,
    thumbnail,
    sourceUrl: videoUrl,
  });

  if (deliveryMode === "stream") {
    try {
      await sock.sendMessage(
        from,
        withChannelInfo({
          audio: { url: downloadUrl },
          mimetype: streamMime,
          ptt: false,
          fileName,
          title: cleanTitle,
        }, metadata),
        quoted
      );
      return;
    } catch (error) {
      lastError = error;
    }

    try {
      await sock.sendMessage(
        from,
        withChannelInfo({
          document: { url: downloadUrl },
          mimetype: streamMime,
          fileName,
          title: cleanTitle,
          caption: buildReadyCaption({ title: cleanTitle, quality: cleanQuality, format: streamFormat }),
        }, metadata),
        quoted
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const prepared = await prepareLocalAudio({
    downloadUrl,
    localFileUrl,
    fileName,
    title: cleanTitle,
    mimetype,
    format,
  }, signal);
  const cleanFormat = prepared.format || format || "MP3";
  const cleanMime = prepared.mimetype || mimetype || "audio/mpeg";
  const cleanFileName = prepared.fileName || fileName || `${safeName(cleanTitle)}.mp3`;
  const sendAsDocument = prepared.size > AUDIO_AS_DOCUMENT_THRESHOLD;

  try {
    if (!sendAsDocument) {
      try {
        await sock.sendMessage(
          from,
          withChannelInfo({
            audio: { url: prepared.filePath },
            mimetype: cleanMime,
            ptt: false,
            fileName: cleanFileName,
            title: cleanTitle,
          }, metadata),
          quoted
        );
        return;
      } catch (error) {
        lastError = error;
      }
    }

    await sock.sendMessage(
      from,
      withChannelInfo({
        document: { url: prepared.filePath },
        mimetype: cleanMime,
        fileName: cleanFileName,
        title: cleanTitle,
        caption: buildReadyCaption({ title: cleanTitle, quality: cleanQuality, format: cleanFormat }),
      }, metadata),
      quoted
    ).catch(() => {
      throw lastError || new Error("No se pudo enviar el audio.");
    });
  } finally {
    for (const filePath of prepared.cleanupPaths || []) {
      deleteFileSafe(filePath);
    }
  }
}

async function sendAudioWithFreshLink(sock, from, quoted, { videoUrl, initialMp3, fallbackTitle, thumbnail, signal, deliveryMode = "file" }) {
  let mp3 = initialMp3;
  let lastError = null;

  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await sendAudioFast(sock, from, quoted, {
        downloadUrl: mp3.downloadUrl,
        localFileUrl: mp3.localFileUrl,
        fileName: mp3.fileName,
        title: mp3.title || fallbackTitle,
        thumbnail: mp3.thumbnail || thumbnail,
        videoUrl,
        mimetype: mp3.mimetype,
        quality: mp3.quality,
        format: mp3.format,
        signal,
        deliveryMode,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= SEND_RETRY_ATTEMPTS || (!isExpiredLinkError(error) && !shouldRetryError(error))) {
        break;
      }
      await sleep(800 * attempt);
      mp3 = await resolveMp3Link(videoUrl, signal, fallbackTitle);
    }
  }

  throw lastError || new Error("No se pudo enviar el audio.");
}

export default {
  command: ["ytmp3", "ytmp3dv"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const abortSignal = ctx.abortSignal || null;
    const userId = `${from}:ytmp3`;
    let charged = null;

    if (COOLDOWN_TIME > 0) {
      const until = cooldowns.get(userId);
      if (until && until > now()) {
        return sock.sendMessage(from, {
          text: `⏳ Espera ${getCooldownRemaining(until)}s`,
          ...global.channelInfo,
        });
      }
      cooldowns.set(userId, now() + COOLDOWN_TIME);
    }

    try {
      const input = resolveInput(ctx);
      if (!input) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp3 <nombre o link>\nOpcional: .ytmp3 --stream <nombre> o .ytmp3 --file <nombre>",
          ...global.channelInfo,
        });
      }

      const parsed = parseDeliveryModeAndInput(input);
      if (!parsed.query) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Escribe titulo o link de YouTube despues del modo.",
          ...global.channelInfo,
        });
      }

      throwIfAborted(abortSignal);
      const candidates = await resolveAudioCandidates(parsed.query, abortSignal);
      const video = candidates[0];

      charged = await chargeDownloadRequest(ctx, {
        feature: "ytmp3",
        title: video.title,
        videoUrl: video.videoUrl,
      });
      if (!charged.ok) {
        cooldowns.delete(userId);
        return;
      }

      await sock.sendMessage(
        from,
        withChannelInfo({
          text: buildStatusText({
            title: video.title,
            quality: AUDIO_QUALITY,
            state: parsed.deliveryMode === "stream" ? "preparando streaming" : "descargando archivo",
          }),
        }, buildMediaContext({
          title: video.title,
          body: `MP3 • ${AUDIO_QUALITY}`,
          thumbnail: video.thumbnail,
          sourceUrl: video.videoUrl,
        })),
        quoted
      );

      throwIfAborted(abortSignal);
      const resolvedAudio = await resolveFirstWorkingAudio(candidates, abortSignal);
      const mp3 = resolvedAudio.audio;
      const selectedVideo = resolvedAudio.video;
      throwIfAborted(abortSignal);

      await sendAudioWithFreshLink(sock, from, quoted, {
        videoUrl: selectedVideo.videoUrl,
        initialMp3: mp3,
        fallbackTitle: selectedVideo.title,
        thumbnail: selectedVideo.thumbnail,
        signal: abortSignal,
        deliveryMode: parsed.deliveryMode,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      refundDownloadCharge(ctx, charged, {
        feature: "ytmp3",
        error: String(error?.message || error || "unknown_error"),
      });
      cooldowns.delete(userId);
      await sock.sendMessage(from, {
        text: `❌ ${toFriendlyError(error)}`,
        ...global.channelInfo,
      });
    }
  },
};
