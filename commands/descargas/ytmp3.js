import axios from "axios";
import { buildDvyerUrl, getDvyerBaseUrl } from "../../lib/api-manager.js";
import { throwIfAborted } from "../../lib/command-abort.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const API_BASE = getDvyerBaseUrl();
const API_MP3_URL = buildDvyerUrl("/ytmp3");
const API_SEARCH_URL = buildDvyerUrl("/ytsearch");
const AUDIO_QUALITY = "128k";
const REQUEST_TIMEOUT = 420000;
const LOCAL_AUDIO_TIMEOUT = 240000;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const LINK_RETRY_ATTEMPTS = 4;
const COOLDOWN_TIME = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

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

function normalizeApiUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (isHttpUrl(value)) return value;
  if (value.startsWith("/")) return `${API_BASE}${value}`;
  return `${API_BASE}/${value}`;
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
    text.includes("service unavailable") ||
    text.includes("temporarily") ||
    text.includes("media unavailable") ||
    text.includes("internal")
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

async function fetchAudioBuffer(downloadUrl, signal) {
  const response = await axios.get(downloadUrl, {
    timeout: LOCAL_AUDIO_TIMEOUT,
    responseType: "arraybuffer",
    signal: signal || undefined,
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "audio/mpeg,audio/*,*/*",
    },
  });

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(response.data || []);
  if (!buffer.length) {
    throw new Error("El audio llego vacio.");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error("El audio es demasiado grande para enviarlo directo.");
  }
  return buffer;
}

async function resolveVideo(rawInput, signal) {
  const videoUrl = extractYouTubeUrl(rawInput);
  if (videoUrl) {
    return { videoUrl, title: "audio", thumbnail: null };
  }

  if (isHttpUrl(rawInput)) {
    throw new Error("Enviame un link valido de YouTube.");
  }

  const query = String(rawInput || "").trim().toLowerCase();
  const cacheKey = `ytsearch:${query}`;
  const cached = readCache(cacheKey);
  if (cached?.videoUrl) {
    return cached;
  }

  const search = await apiGet(API_SEARCH_URL, { q: rawInput, limit: 1 }, signal);
  const first = search?.results?.[0];
  if (!first?.url) {
    throw new Error("No encontre resultados para ese titulo.");
  }

  const result = {
    videoUrl: String(first.url).trim(),
    title: safeName(first.title || "audio"),
    thumbnail: first.thumbnail || null,
  };
  writeCache(cacheKey, result);
  return result;
}

async function resolveMp3Link(videoUrl, signal, preferredTitle = "") {
  const cacheKey = `ytmp3:${videoUrl}:${AUDIO_QUALITY}`;
  const cached = readCache(cacheKey);
  if (cached?.downloadUrl) {
    return cached;
  }

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

  const cleanedTitle = safeName(payload?.title || preferredTitle || "audio");
  const fileBase = safeName(
    String(cleanedTitle || "audio").replace(/\.[^.]+$/i, ""),
    "audio"
  );
  const result = {
    downloadUrl,
    title: cleanedTitle,
    fileName: `${fileBase}.mp3`,
  };
  writeCache(cacheKey, result);
  return result;
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
  if (low.includes("media unavailable")) {
    return "Ese audio no esta disponible ahora mismo. Prueba en unos segundos o con otro video.";
  }
  return text || "Error al procesar el audio.";
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - now()) / 1000));
}

async function sendAudioFast(sock, from, quoted, { downloadUrl, fileName, title, signal }) {
  let lastError = null;
  try {
    await sock.sendMessage(
      from,
      {
        audio: { url: downloadUrl },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName,
        ...global.channelInfo,
      },
      quoted
    );
    return;
  } catch (error) {
    lastError = error;
  }

  try {
    await sock.sendMessage(
      from,
      {
        document: { url: downloadUrl },
        mimetype: "audio/mpeg",
        fileName,
        caption: `🎵 ${title}`,
        ...global.channelInfo,
      },
      quoted
    );
    return;
  } catch (error) {
    lastError = error;
  }

  const buffer = await fetchAudioBuffer(downloadUrl, signal);
  try {
    await sock.sendMessage(
      from,
      {
        audio: buffer,
        mimetype: "audio/mpeg",
        ptt: false,
        fileName,
        ...global.channelInfo,
      },
      quoted
    );
    return;
  } catch (error) {
    lastError = error;
  }

  await sock.sendMessage(
    from,
    {
      document: buffer,
      mimetype: "audio/mpeg",
      fileName,
      caption: `🎵 ${title}`,
      ...global.channelInfo,
    },
    quoted
  ).catch(() => {
    throw lastError || new Error("No se pudo enviar el audio.");
  });
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
          text: "❌ Uso: .ytmp3 <nombre o link de YouTube>",
          ...global.channelInfo,
        });
      }

      throwIfAborted(abortSignal);
      const video = await resolveVideo(input, abortSignal);

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
        {
          text: `🎵 DVYER MP3\n🎧 ${video.title}\n🎚️ ${AUDIO_QUALITY}\n⏳ Preparando descarga...`,
          ...global.channelInfo,
        },
        quoted
      );

      throwIfAborted(abortSignal);
      const mp3 = await resolveMp3Link(video.videoUrl, abortSignal, video.title);
      throwIfAborted(abortSignal);

      await sendAudioFast(sock, from, quoted, {
        downloadUrl: mp3.downloadUrl,
        fileName: mp3.fileName,
        title: mp3.title || video.title,
        signal: abortSignal,
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
