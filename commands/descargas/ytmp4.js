import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { buildDvyerUrl, getDvyerBaseUrl } from "../../lib/api-manager.js";
import { throwIfAborted } from "../../lib/command-abort.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const API_BASE = getDvyerBaseUrl();
const API_SEARCH_URL = buildDvyerUrl("/ytsearch");
const VIDEO_ENDPOINTS = [
  buildDvyerUrl("/ytdlmp4"),
];
const TMP_DIR = path.join(os.tmpdir(), "dvyer-ytmp4");

const LINK_TIMEOUT_FAST = 90000;
const LINK_TIMEOUT_STABLE = 210000;
const LOCAL_VIDEO_TIMEOUT = 420000;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const VIDEO_AS_DOCUMENT_THRESHOLD = 70 * 1024 * 1024;
const VIDEO_QUALITIES = ["1080p", "720p", "480p", "360p", "240p", "144p"];
const DEFAULT_VIDEO_QUALITY = "360p";
const COOLDOWN_TIME = 0;
const LINK_RETRY_ATTEMPTS = 2;
const ENDPOINT_UNHEALTHY_TTL_MS = 5 * 60 * 1000;
const SEND_RETRY_ATTEMPTS = 2;

const cooldowns = new Map();
const endpointUnhealthyUntil = new Map();

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeText(value, fallback = "") {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function displayTitle(value, fallback = "video youtube") {
  const text = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text || fallback;
}

function safeFileName(value, fallback = "video") {
  const clean = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
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

function buildStatusText({ title, quality, state }) {
  return [
    "╭─〔 *𝑫𝑽𝒀𝑬𝑹 • 𝑴𝑷𝟒* 〕",
    `┃ ▣ *Título:* ${displayTitle(title)}`,
    `┃ ⌁ *Calidad:* ${quality}`,
    `┃ ◈ *Estado:* ${state}`,
    "╰─⟡ _Validando stream y metadata..._",
  ].join("\n");
}

function buildReadyCaption({ title, quality }) {
  return [
    "╭─〔 *𝑫𝑽𝒀𝑬𝑹 • 𝑽𝑰𝑫𝑬𝑶* 〕",
    `┃ ▣ *${displayTitle(title)}*`,
    `┃ ⌁ *Calidad:* ${quality}`,
    "╰─⟡ _Video listo_",
  ].join("\n");
}

function buildMediaContext({ title, body, thumbnail, sourceUrl }) {
  const channelContext = global.channelInfo?.contextInfo || {};
  const externalAdReply = {
    title: displayTitle(title),
    body: body || "DVYER MP4 • descarga directa",
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

function normalizeMp4Name(value) {
  const base = safeFileName(String(value || "video").replace(/\.mp4$/i, ""), "video");
  return `${base}.mp4`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function normalizeApiUrl(value) {
  const text = safeText(value);
  if (!text) return "";
  if (isHttpUrl(text)) return text;
  if (text.startsWith("/")) return `${API_BASE}${text}`;
  return `${API_BASE}/${text}`;
}

function buildApiVideoFileUrl(endpointUrl, videoUrl, quality, fastMode = false) {
  const target = new URL(endpointUrl);
  target.searchParams.set("mode", "file");
  target.searchParams.set("fast", fastMode ? "true" : "false");
  target.searchParams.set("url", videoUrl);
  target.searchParams.set("quality", quality || DEFAULT_VIDEO_QUALITY);
  return target.toString();
}

function pickVideoStreamUrl(payload) {
  return (
    payload?.stream_url_full ||
    payload?.download_url_full ||
    payload?.stream_url ||
    payload?.download_url ||
    payload?.url ||
    payload?.result?.stream_url_full ||
    payload?.result?.download_url_full ||
    payload?.result?.stream_url ||
    payload?.result?.download_url ||
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

function qualityValue(quality) {
  const match = String(quality || "").match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function normalizeVideoQuality(value) {
  const text = safeText(value).toLowerCase();
  if (!text) return "";
  if (text === "best" || text === "max" || text === "highest") return "1080p";
  if (text === "fhd" || text === "fullhd") return "1080p";
  if (text === "hd") return "720p";
  const match = text.match(/(\d{3,4})p?$/);
  if (!match) return "";
  const normalized = `${match[1]}p`;
  return VIDEO_QUALITIES.includes(normalized) ? normalized : "";
}

function qualityCandidatesFromRequested(requestedQuality) {
  const normalized = normalizeVideoQuality(requestedQuality) || DEFAULT_VIDEO_QUALITY;
  const selectedValue = qualityValue(normalized);
  const lowerOrEqual = VIDEO_QUALITIES.filter((item) => qualityValue(item) <= selectedValue);
  const higher = [...VIDEO_QUALITIES]
    .filter((item) => qualityValue(item) > selectedValue)
    .sort((a, b) => qualityValue(a) - qualityValue(b));
  return [...lowerOrEqual, ...higher];
}

function parseQualityAndInput(rawInput) {
  const text = safeText(rawInput);
  if (!text) {
    return { query: "", quality: DEFAULT_VIDEO_QUALITY };
  }

  let query = text;
  let quality = "";
  let deliveryMode = "file";

  const modeFlagMatch = query.match(/--?(stream|streaming|file|direct|download|descarga)\b/i);
  if (modeFlagMatch) {
    const value = modeFlagMatch[1].toLowerCase();
    deliveryMode = value.startsWith("stream") ? "stream" : "file";
    query = safeText(query.replace(modeFlagMatch[0], " "));
  }

  const [maybeMode, ...modeRest] = query.split(/\s+/);
  const modeToken = String(maybeMode || "").toLowerCase();
  if (["stream", "streaming", "file", "direct", "download", "descarga"].includes(modeToken)) {
    deliveryMode = modeToken.startsWith("stream") ? "stream" : "file";
    query = safeText(modeRest.join(" "));
  }

  const flagMatch = query.match(/--?(?:q|quality)\s*=?\s*([a-z0-9]+)/i);
  if (flagMatch) {
    quality = normalizeVideoQuality(flagMatch[1]);
    query = safeText(query.replace(flagMatch[0], " "));
  }

  if (!quality) {
    const [firstToken, ...rest] = query.split(/\s+/);
    const firstQuality = normalizeVideoQuality(firstToken);
    if (firstQuality) {
      quality = firstQuality;
      query = safeText(rest.join(" "));
    }
  }

  if (!quality) {
    const tokens = query.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || "";
    const lastQuality = normalizeVideoQuality(lastToken);
    if (lastQuality) {
      quality = lastQuality;
      query = safeText(tokens.slice(0, -1).join(" "));
    }
  }

  return {
    query,
    quality: quality || DEFAULT_VIDEO_QUALITY,
    deliveryMode,
  };
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - now()) / 1000));
}

function shouldRetryError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("socket hang up") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("unauthorized") ||
    text.includes("401") ||
    text.includes("410") ||
    text.includes("expired") ||
    text.includes("expirado") ||
    text.includes("invalido") ||
    text.includes("invalid") ||
    text.includes("temporarily") ||
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

function isUnauthorizedLikeError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("unauthorized") || text.includes("http 401") || text.includes("401");
}

function isEndpointAvailable(endpointUrl) {
  const until = endpointUnhealthyUntil.get(endpointUrl) || 0;
  return until <= now();
}

function markEndpointTemporarilyUnhealthy(endpointUrl, ttlMs = ENDPOINT_UNHEALTHY_TTL_MS) {
  endpointUnhealthyUntil.set(endpointUrl, now() + ttlMs);
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

function toFriendlyError(error) {
  const text = hideProviderText(error?.message || error || "");
  const lower = text.toLowerCase();
  if (lower.includes("demasiado grande")) {
    return "El video es muy grande para enviarlo directo. Prueba 360p o 240p.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "El servidor tardo demasiado. Intenta de nuevo.";
  }
  if (lower.includes("429") || lower.includes("too many requests")) {
    return "Hay muchas solicitudes ahora. Intenta en unos segundos.";
  }
  if (lower.includes("410") || lower.includes("expirado") || lower.includes("expired")) {
    return "El enlace temporal expiro mientras WhatsApp lo abria. Reintenta y se generara uno nuevo.";
  }
  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "Servicio temporalmente inestable para video. Reintenta en unos segundos.";
  }
  if (lower.includes("no se encontro una calidad video disponible")) {
    return "No se logro la calidad exacta ahora. Intenta de nuevo en unos segundos.";
  }
  return text || "Error al procesar el video.";
}

async function apiGet(url, params, timeoutMs, signal) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
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

async function downloadVideoFile(fileUrl, { fileName, title, signal }) {
  ensureTmpDir();
  const response = await axios.get(fileUrl, {
    timeout: LOCAL_VIDEO_TIMEOUT,
    responseType: "stream",
    signal: signal || undefined,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "video/mp4,video/*,*/*",
    },
  });

  if (response.status >= 400) {
    const detail = hideProviderText(await readStreamText(response.data));
    throw new Error(detail || `HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength && contentLength > MAX_VIDEO_BYTES) {
    throw new Error("El video es demasiado grande para enviarlo directo.");
  }

  const headerName = parseFileNameFromDisposition(response.headers?.["content-disposition"]);
  const normalizedName = normalizeMp4Name(headerName || fileName || title || "video");
  const outputPath = path.join(TMP_DIR, `${Date.now()}-${randomUUID()}-${normalizedName}`);
  const outputStream = fs.createWriteStream(outputPath);
  let downloaded = 0;

  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_VIDEO_BYTES) {
      response.data.destroy(new Error("El video es demasiado grande para enviarlo directo."));
    }
  });

  try {
    await pipeline(response.data, outputStream);
  } catch (error) {
    deleteFileSafe(outputPath);
    throw error;
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el video temporal.");
  }
  const size = fs.statSync(outputPath).size;
  if (!size || size < 1024) {
    deleteFileSafe(outputPath);
    throw new Error("El video llego vacio o incompleto.");
  }
  if (size > MAX_VIDEO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El video es demasiado grande para enviarlo directo.");
  }

  return {
    filePath: outputPath,
    size,
    fileName: normalizedName,
  };
}

async function resolveVideoInput(rawInput, signal) {
  const videoUrl = extractYouTubeUrl(rawInput);
  if (videoUrl) {
    return { videoUrl, title: "video youtube", thumbnail: null };
  }
  if (isHttpUrl(rawInput)) {
    throw new Error("Enviame un link valido de YouTube.");
  }
  const search = await apiGet(API_SEARCH_URL, { q: rawInput, limit: 1 }, 30000, signal);
  const first = search?.results?.[0];
  if (!first?.url) {
    throw new Error("No encontre resultados para ese titulo.");
  }
  return {
    videoUrl: safeText(first.url),
    title: displayTitle(first.title, "video youtube"),
    thumbnail: first.thumbnail || null,
  };
}

async function requestVideoLink(endpointUrl, videoUrl, quality, signal, { fastMode, timeoutMs }) {
  let lastError = null;
  for (let attempt = 1; attempt <= LINK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const payload = await apiGet(
        endpointUrl,
        {
          mode: "link",
          fast: fastMode ? "true" : "false",
          url: videoUrl,
          quality,
        },
        timeoutMs,
        signal
      );
      const streamUrl = normalizeApiUrl(pickVideoStreamUrl(payload));
      if (!streamUrl) {
        throw new Error("No se obtuvo enlace de stream.");
      }
      const title = displayTitle(payload?.title, "video youtube");
      const fileName = normalizeMp4Name(title);
      const resolvedQuality = safeText(payload?.quality || payload?.provider_quality || quality, quality);
      return {
        streamUrl,
        localFileUrl: buildApiVideoFileUrl(endpointUrl, videoUrl, resolvedQuality || quality, false),
        title,
        fileName,
        quality: resolvedQuality,
        thumbnail: payload?.thumbnail || payload?.image || null,
      };
    } catch (error) {
      lastError = error;
      if (isUnauthorizedLikeError(error)) {
        markEndpointTemporarilyUnhealthy(endpointUrl);
      }
      if (attempt >= LINK_RETRY_ATTEMPTS || !shouldRetryError(error)) {
        break;
      }
      await sleep(900 * attempt);
    }
  }
  throw lastError || new Error("No se pudo preparar enlace de video.");
}

async function resolveVideoLink(videoUrl, requestedQuality, signal) {
  const qualityCandidates = qualityCandidatesFromRequested(requestedQuality);

  const selectedValue = qualityValue(requestedQuality || DEFAULT_VIDEO_QUALITY);
  const strategies =
    selectedValue > 360
      ? [
          { fastMode: false, timeoutMs: LINK_TIMEOUT_STABLE, qualities: qualityCandidates },
          { fastMode: true, timeoutMs: LINK_TIMEOUT_FAST, qualities: qualityCandidates },
        ]
      : [
          { fastMode: true, timeoutMs: LINK_TIMEOUT_FAST, qualities: qualityCandidates },
          { fastMode: false, timeoutMs: LINK_TIMEOUT_STABLE, qualities: qualityCandidates },
        ];

  let lastError = null;
  const attempted = new Set();
  const availableEndpoints = VIDEO_ENDPOINTS.filter((endpointUrl) => isEndpointAvailable(endpointUrl));
  const endpointOrder = availableEndpoints.length ? availableEndpoints : VIDEO_ENDPOINTS;
  for (const strategy of strategies) {
    for (const endpointUrl of endpointOrder) {
      for (const quality of strategy.qualities) {
        const dedupeKey = `${strategy.fastMode}:${endpointUrl}:${quality}`;
        if (attempted.has(dedupeKey)) continue;
        attempted.add(dedupeKey);
        try {
          const resolved = await requestVideoLink(endpointUrl, videoUrl, quality, signal, strategy);
          return { ...resolved, quality: resolved.quality || quality };
        } catch (error) {
          lastError = error;
        }
      }
    }
  }

  throw lastError || new Error("No se pudo obtener un enlace de video.");
}

async function sendVideo(sock, from, quoted, { streamUrl, localFileUrl, title, fileName, quality, thumbnail, videoUrl, signal, deliveryMode = "file" }) {
  let lastError = null;
  const cleanTitle = displayTitle(title);
  const cleanQuality = safeText(quality, DEFAULT_VIDEO_QUALITY);
  const caption = buildReadyCaption({ title: cleanTitle, quality: cleanQuality });
  const metadata = buildMediaContext({
    title: cleanTitle,
    body: `MP4 • ${cleanQuality} • DVYER`,
    thumbnail,
    sourceUrl: videoUrl,
  });

  if (deliveryMode === "stream") {
    try {
      await sock.sendMessage(
        from,
        withChannelInfo({
          video: { url: streamUrl },
          mimetype: "video/mp4",
          fileName,
          title: cleanTitle,
          caption,
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
          document: { url: streamUrl },
          mimetype: "video/mp4",
          fileName,
          title: cleanTitle,
          caption,
        }, metadata),
        quoted
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const prepared = await downloadVideoFile(localFileUrl || streamUrl, {
    fileName,
    title: cleanTitle,
    signal,
  });
  const cleanFileName = prepared.fileName || fileName || normalizeMp4Name(cleanTitle);
  const sendAsDocument = prepared.size > VIDEO_AS_DOCUMENT_THRESHOLD;

  try {
    if (!sendAsDocument) {
      try {
        await sock.sendMessage(
          from,
          withChannelInfo({
            video: { url: prepared.filePath },
            mimetype: "video/mp4",
            fileName: cleanFileName,
            title: cleanTitle,
            caption,
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
        mimetype: "video/mp4",
        fileName: cleanFileName,
        title: cleanTitle,
        caption,
      }, metadata),
      quoted
    ).catch(() => {
      throw lastError || new Error("No se pudo enviar el video.");
    });
  } finally {
    deleteFileSafe(prepared.filePath);
  }
}

async function sendVideoWithFreshLink(sock, from, quoted, { videoUrl, requestedQuality, initialResolved, fallbackTitle, thumbnail, signal, deliveryMode = "file" }) {
  let resolved = initialResolved;
  let lastError = null;

  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await sendVideo(sock, from, quoted, {
        streamUrl: resolved.streamUrl,
        localFileUrl: resolved.localFileUrl,
        title: displayTitle(resolved.title || fallbackTitle, "video youtube"),
        fileName: normalizeMp4Name(resolved.title || fallbackTitle),
        quality: resolved.quality || requestedQuality || DEFAULT_VIDEO_QUALITY,
        thumbnail: resolved.thumbnail || thumbnail,
        videoUrl,
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
      resolved = await resolveVideoLink(videoUrl, requestedQuality, signal);
    }
  }

  throw lastError || new Error("No se pudo enviar el video.");
}

export default {
  command: ["ytmp4", "ytdlmp4", "ytaltmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const abortSignal = ctx.abortSignal || null;
    const userId = `${from}:ytmp4`;
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
          text: "❌ Uso: .ytmp4 <nombre o link>\nOpcional: .ytmp4 --stream 360p <nombre> o .ytmp4 --file 720p <link>.",
          ...global.channelInfo,
        });
      }
      const parsed = parseQualityAndInput(input);
      if (!parsed.query) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Escribe titulo o link de YouTube despues de la calidad.",
          ...global.channelInfo,
        });
      }

      throwIfAborted(abortSignal);
      const video = await resolveVideoInput(parsed.query, abortSignal);
      throwIfAborted(abortSignal);

      charged = await chargeDownloadRequest(ctx, {
        feature: "ytmp4",
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
            quality: parsed.quality,
            state: parsed.deliveryMode === "stream" ? "preparando streaming" : "descargando archivo",
          }),
        }, buildMediaContext({
          title: video.title,
          body: `MP4 • ${parsed.quality}`,
          thumbnail: video.thumbnail,
          sourceUrl: video.videoUrl,
        })),
        quoted
      );

      throwIfAborted(abortSignal);
      const resolved = await resolveVideoLink(video.videoUrl, parsed.quality, abortSignal);
      throwIfAborted(abortSignal);

      await sendVideoWithFreshLink(sock, from, quoted, {
        videoUrl: video.videoUrl,
        requestedQuality: parsed.quality,
        initialResolved: resolved,
        fallbackTitle: video.title,
        thumbnail: video.thumbnail,
        signal: abortSignal,
        deliveryMode: parsed.deliveryMode,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      refundDownloadCharge(ctx, charged, {
        feature: "ytmp4",
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
