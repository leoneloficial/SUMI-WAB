import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import { getDvyerBaseUrl } from "../../lib/api-manager.js";
import { bindAbort, buildAbortError, throwIfAborted } from "../../lib/command-abort.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const LEGACY_DVYER_BASE_URL = "https://dv-yer-api.online";
const PREFERRED_DVYER_BASE_URL = "https://dvyer-api.onrender.com";
const API_SPOTIFY_PATH = "/spotify";

const COOLDOWN_TIME = 15 * 1000;
const REQUEST_TIMEOUT = 120000;
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const AUDIO_AS_DOCUMENT_THRESHOLD = 60 * 1024 * 1024;
const AUDIO_QUALITY = "128k";
const TMP_DIR = path.join(os.tmpdir(), "dvyer-spotify");

const cooldowns = new Map();

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function apiBaseLabel() {
  const configured = String(getDvyerBaseUrl() || "")
    .trim()
    .replace(/\/+$/, "");

  if (!configured || configured === LEGACY_DVYER_BASE_URL) {
    return PREFERRED_DVYER_BASE_URL;
  }

  return configured;
}

function buildApiUrl(endpoint = "") {
  const base = apiBaseLabel();
  const suffix = String(endpoint || "").trim();

  if (!suffix) return base;
  if (/^https?:\/\//i.test(suffix)) return suffix;
  if (suffix.startsWith("/")) return `${base}${suffix}`;
  return `${base}/${suffix}`;
}

function normalizeApiUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${apiBaseLabel()}${value}`;
  return `${apiBaseLabel()}/${value}`;
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

async function fetchSpotifyOEmbed(spotifyUrl, signal = null) {
  const cleanedUrl = String(spotifyUrl || "").trim();
  if (!cleanedUrl) return {};

  const response = await axios.get("https://open.spotify.com/oembed", {
    params: { url: cleanedUrl },
    timeout: 15000,
    signal,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Referer: "https://open.spotify.com/",
    },
    validateStatus: () => true,
  });

  if (response.status >= 400 || !response.data || typeof response.data !== "object") {
    return {};
  }

  const payload = {
    title: cleanText(response.data?.title || ""),
    artist: cleanText(response.data?.author_name || ""),
    thumbnail: String(response.data?.thumbnail_url || "").trim() || null,
  };

  if (payload.title && payload.artist) {
    return payload;
  }

  const pageResponse = await axios.get(cleanedUrl, {
    timeout: 15000,
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Referer: "https://open.spotify.com/",
    },
    validateStatus: () => true,
  });

  if (pageResponse.status >= 400 || typeof pageResponse.data !== "string") {
    return payload;
  }

  const html = String(pageResponse.data || "");
  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const descriptionMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);

  const pageTitle = cleanText(titleMatch?.[1] || "");
  const description = cleanText(descriptionMatch?.[1] || "");
  const pageArtist = cleanText(description.split("·")[0] || "");

  return {
    title: pageTitle || payload.title,
    artist: pageArtist || payload.artist,
    thumbnail: payload.thumbnail,
  };
}

function deleteFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function safeFileName(name) {
  return (
    String(name || "spotify")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "spotify"
  );
}

function normalizeMp3Name(name) {
  const clean = safeFileName(String(name || "spotify").replace(/\.(mp3|m4a|mp4|aac|webm)$/i, ""));
  return `${clean || "spotify"}.mp3`;
}

function normalizeAudioFileName(name, fallbackBase = "spotify", fallbackExt = "m4a") {
  const parsed = path.parse(String(name || "").trim());
  const ext = String(parsed.ext || `.${fallbackExt}`).replace(/^\./, "").toLowerCase() || fallbackExt;
  const base = safeFileName(parsed.name || fallbackBase);
  return `${base}.${ext}`;
}

function buildAudioMeta(fileName, contentType, fallbackBase = "spotify", sniffed = null) {
  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  const rawName = String(fileName || "").trim();
  const ext = path.extname(rawName).replace(/^\./, "").toLowerCase();

  if (sniffed?.ext) {
    return {
      fileName: normalizeAudioFileName(rawName, fallbackBase, sniffed.ext),
      mimetype: sniffed.mimetype,
      isMp3: sniffed.isMp3,
    };
  }

  let finalExt = ext || "bin";
  let mimetype = normalizedType || "application/octet-stream";

  if (ext === "mp3" || normalizedType.includes("audio/mpeg")) {
    finalExt = "mp3";
    mimetype = "audio/mpeg";
  } else if (ext === "m4a" || ext === "mp4" || normalizedType.includes("audio/mp4")) {
    finalExt = "m4a";
    mimetype = "audio/mp4";
  } else if (ext === "aac" || normalizedType.includes("audio/aac")) {
    finalExt = "aac";
    mimetype = "audio/aac";
  } else if (ext === "webm" || normalizedType.includes("audio/webm")) {
    finalExt = "webm";
    mimetype = "audio/webm";
  }

  return {
    fileName: normalizeAudioFileName(rawName, fallbackBase, finalExt),
    mimetype,
    isMp3: finalExt === "mp3",
  };
}

function detectAudioFromFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const slice = buffer.subarray(0, bytesRead);

    if (slice.length >= 8 && slice.subarray(4, 8).toString("ascii") === "ftyp") {
      return { ext: "m4a", mimetype: "audio/mp4", isMp3: false };
    }

    if (slice.length >= 3 && slice.subarray(0, 3).toString("ascii") === "ID3") {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }

    if (slice.length >= 4 && slice[0] === 0x1a && slice[1] === 0x45 && slice[2] === 0xdf && slice[3] === 0xa3) {
      return { ext: "webm", mimetype: "audio/webm", isMp3: false };
    }

    if (slice.length >= 2 && slice[0] === 0xff && (slice[1] & 0xe0) === 0xe0) {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }
  } catch {}

  return null;
}

function parseContentDispositionFileName(headerValue) {
  const text = String(headerValue || "");
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);

  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]).replace(/["']/g, "").trim();
    } catch {}
  }

  const normalMatch = text.match(/filename="?([^"]+)"?/i);
  if (normalMatch?.[1]) {
    return normalMatch[1].trim();
  }

  return "";
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractTextFromMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.message?.documentMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ""
  );
}

function getQuotedMessage(ctx, msg) {
  return (
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function resolveUserInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quotedMessage = getQuotedMessage(ctx, msg);
  const quotedText = extractTextFromMessage(quotedMessage);
  return argsText || quotedText || "";
}

function isSpotifyUrl(value) {
  return /^(https?:\/\/)?(open\.spotify\.com|spotify\.link)\//i.test(
    String(value || "").trim()
  );
}

function extractSpotifyEntityType(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const uriMatch = text.match(/^spotify:([a-z]+):/i);
  if (uriMatch?.[1]) {
    return String(uriMatch[1]).toLowerCase();
  }

  const urlMatch = text.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?([a-z]+)\//i);
  if (urlMatch?.[1]) {
    return String(urlMatch[1]).toLowerCase();
  }

  return "";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function parseSpotifySelectionInput(value) {
  const raw = String(value || "").trim();
  const patterns = [
    /^--pick=(\d+)\s+(.+)$/i,
    /^pick[:=](\d+)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;

    return {
      pick: Math.max(1, Math.min(20, Number(match[1] || 1))),
      target: String(match[2] || "").trim(),
    };
  }

  return {
    pick: 1,
    target: raw,
  };
}

function pickApiDownloadUrl(data) {
  return (
    data?.download_url_full ||
    data?.stream_url_full ||
    data?.download_link ||
    data?.stream_link ||
    data?.download_url ||
    data?.stream_url ||
    data?.url_full ||
    data?.url ||
    data?.selected?.download_url_full ||
    data?.selected?.stream_url_full ||
    data?.selected?.download_link ||
    data?.selected?.stream_link ||
    data?.selected?.download_url ||
    data?.selected?.stream_url ||
    ""
  );
}

async function requestSpotifyInfo(input, options = {}) {
  const signal = options?.signal || null;
  const cleanedInput = cleanText(input);
  const params = {
    mode: "link",
    pick: Math.max(1, Math.min(20, Number(options?.pick || 1))),
    limit: 5,
    lang: "es3",
  };

  if (isSpotifyUrl(cleanedInput)) {
    params.url = cleanedInput;
  } else {
    params.q = cleanedInput;
  }

  const response = await axios.get(buildApiUrl(API_SPOTIFY_PATH), {
    params,
    timeout: REQUEST_TIMEOUT,
    signal,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error(cleanText(extractApiError(response.data, response.status)) || "La API de Spotify fallo.");
  }

  const data = response.data || {};
  const downloadUrl = normalizeApiUrl(pickApiDownloadUrl(data));
  if (!downloadUrl) {
    throw new Error("La API no devolvio enlace de descarga.");
  }

  const spotifyUrl = cleanText(data?.spotify_url || data?.selected?.spotify_url || cleanedInput);
  const oembed = isSpotifyUrl(spotifyUrl) ? await fetchSpotifyOEmbed(spotifyUrl, signal).catch(() => ({})) : {};
  const title = cleanText(oembed.title || data?.title || data?.selected?.title || "spotify") || "spotify";
  const artist = cleanText(oembed.artist || data?.artist || data?.selected?.artist || "Spotify") || "Spotify";
  const duration = cleanText(data?.duration || data?.selected?.duration || "");
  const thumbnail = oembed.thumbnail || data?.thumbnail || data?.selected?.thumbnail || null;
  const rawFileName =
    String(data?.filename || data?.selected?.filename || `${title} - ${artist}.m4a`).trim() ||
    `${title} - ${artist}.m4a`;

  return {
    rawTitle: title,
    title: safeFileName(title),
    artist,
    duration: duration || null,
    thumbnail,
    spotifyUrl,
    fileName: normalizeAudioFileName(rawFileName, `${title} - ${artist}`, "m4a"),
    downloadUrl,
  };
}

async function readStreamToText(stream) {
  return await new Promise((resolve, reject) => {
    let data = "";

    stream.on("data", (chunk) => {
      data += chunk.toString();
    });

    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

async function downloadSpotifyAudio(downloadUrl, outputPath, suggestedFileName = "spotify.m4a", options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);

  let response;
  try {
    response = await axios.get(downloadUrl, {
      responseType: "stream",
      timeout: REQUEST_TIMEOUT,
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "*/*",
      },
      maxRedirects: 5,
      validateStatus: () => true,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw buildAbortError(signal);
    }
    throw error;
  }

  if (response.status >= 400) {
    const errorText = await readStreamToText(response.data).catch(() => "");
    let parsed = null;

    try {
      parsed = JSON.parse(errorText);
    } catch {}

    throw new Error(
      cleanText(
        extractApiError(parsed || { message: errorText || "No se pudo descargar el audio." }, response.status)
      ) || "No se pudo descargar el audio."
    );
  }

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength && contentLength > MAX_AUDIO_BYTES) {
    throw new Error("El audio es demasiado grande para enviarlo por WhatsApp.");
  }

  let downloaded = 0;
  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_AUDIO_BYTES) {
      response.data.destroy(new Error("El audio es demasiado grande para enviarlo por WhatsApp."));
    }
  });

  const outputStream = fs.createWriteStream(outputPath);
  const releaseAbort = bindAbort(signal, () => {
    const abortError = buildAbortError(signal);
    response.data?.destroy?.(abortError);
    outputStream.destroy(abortError);
    deleteFileSafe(outputPath);
  });

  try {
    await pipeline(response.data, outputStream);
  } catch (error) {
    deleteFileSafe(outputPath);
    if (signal?.aborted) {
      throw buildAbortError(signal);
    }
    throw error;
  } finally {
    releaseAbort();
  }

  throwIfAborted(signal);

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el audio.");
  }

  const size = fs.statSync(outputPath).size;
  if (!size || size < 50000) {
    deleteFileSafe(outputPath);
    throw new Error("El audio descargado es invalido.");
  }

  if (size > MAX_AUDIO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El audio es demasiado grande para enviarlo por WhatsApp.");
  }

  const detectedName = parseContentDispositionFileName(response.headers?.["content-disposition"]);
  const sniffed = detectAudioFromFile(outputPath);
  const audioMeta = buildAudioMeta(
    detectedName || suggestedFileName || path.basename(outputPath),
    response.headers?.["content-type"],
    "spotify",
    sniffed
  );

  return {
    tempPath: outputPath,
    size,
    fileName: audioMeta.fileName,
    mimetype: audioMeta.mimetype,
    isMp3: audioMeta.isMp3,
  };
}

async function convertToMp3(inputPath, outputPath, options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);

  return await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
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
        "-map_metadata",
        "-1",
        "-loglevel",
        "error",
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let errorText = "";
    let settled = false;
    const releaseAbort = bindAbort(signal, () => {
      deleteFileSafe(outputPath);
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
    });

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      releaseAbort();
      reject(signal?.aborted ? buildAbortError(signal) : error);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      releaseAbort();
      resolve();
    };

    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      if (error?.code === "ENOENT") {
        finishReject(new Error("ffmpeg no esta instalado en el hosting."));
        return;
      }
      finishReject(error);
    });

    ffmpeg.on("close", (code) => {
      if (signal?.aborted) {
        finishReject(buildAbortError(signal));
        return;
      }

      if (code === 0) {
        finishResolve();
        return;
      }

      finishReject(new Error(errorText.trim() || `ffmpeg salio con codigo ${code}`));
    });
  });
}

async function sendSpotifyAudio(
  sock,
  from,
  quoted,
  { filePath, fileName, mimetype, title, artist, size, forceDocument = false }
) {
  const artistLabel = cleanText(artist || "Spotify") || "Spotify";
  const shouldSendDocument =
    forceDocument || size > AUDIO_AS_DOCUMENT_THRESHOLD || mimetype !== "audio/mpeg";

  if (shouldSendDocument) {
    await sock.sendMessage(
      from,
      {
        document: { url: filePath },
        mimetype: mimetype || "audio/mpeg",
        fileName,
        caption: `Spotify\n\n🎵 ${title}\n🎤 ${artistLabel}\n📦 Enviado como documento`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }

  try {
    await sock.sendMessage(
      from,
      {
        audio: { url: filePath },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName,
        ...global.channelInfo,
      },
      quoted
    );
    return "audio";
  } catch (error) {
    console.error("send spotify audio failed:", error?.message || error);

    await sock.sendMessage(
      from,
      {
        document: { url: filePath },
        mimetype: mimetype || "audio/mpeg",
        fileName,
        caption: `Spotify\n\n🎵 ${title}\n🎤 ${artistLabel}\n📦 Enviado como documento`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }
}

export default {
  command: ["spotify", "spoti"],
  category: "descarga",
  description: "Descarga Spotify usando la DVYER API nueva",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const abortSignal = ctx.abortSignal || null;
    const userId = `${from}:spotify`;

    let rawAudioPath = null;
    let finalMp3Path = null;
    let downloadCharge = null;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(
        from,
        {
          text: `⏳ Espera ${getCooldownRemaining(until)}s`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      const parsedInput = parseSpotifySelectionInput(resolveUserInput(ctx));
      const userInput = parsedInput.target;

      if (!userInput) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Uso: .spotify <cancion o link de Spotify>",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (extractYouTubeUrl(userInput)) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Este comando solo usa busquedas o links de Spotify.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const spotifyEntityType = extractSpotifyEntityType(userInput);
      if (spotifyEntityType && spotifyEntityType !== "track") {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Por ahora solo se admite enlace de *track* de Spotify o una busqueda por texto.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (isHttpUrl(userInput) && !isSpotifyUrl(userInput)) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Enviame una cancion o un link valido de Spotify.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const info = await requestSpotifyInfo(userInput, {
        pick: parsedInput.pick,
        signal: abortSignal,
      });

      downloadCharge = await chargeDownloadRequest(ctx, {
        feature: "spotify",
        query: userInput,
        spotifyUrl: info.spotifyUrl || "",
        title: info.rawTitle,
      });

      if (!downloadCharge.ok) {
        cooldowns.delete(userId);
        return;
      }

      await sock.sendMessage(
        from,
        info.thumbnail
          ? {
              image: { url: info.thumbnail },
              caption:
                `🎵 Preparando descarga...\n\n` +
                `🎧 ${info.rawTitle}\n` +
                `🎤 ${info.artist}\n` +
                `${info.duration ? `⏱ ${info.duration}\n` : ""}` +
                `🌐 ${apiBaseLabel()}`,
              ...global.channelInfo,
            }
          : {
              text:
                `🎵 Preparando descarga...\n\n` +
                `🎧 ${info.rawTitle}\n` +
                `🎤 ${info.artist}\n` +
                `${info.duration ? `⏱ ${info.duration}\n` : ""}` +
                `🌐 ${apiBaseLabel()}`,
              ...global.channelInfo,
            },
        quoted
      );

      const stamp = Date.now();
      rawAudioPath = path.join(TMP_DIR, `${stamp}-spotify-source.bin`);
      finalMp3Path = path.join(TMP_DIR, `${stamp}-spotify-final.mp3`);

      const downloaded = await downloadSpotifyAudio(info.downloadUrl, rawAudioPath, info.fileName, {
        signal: abortSignal,
      });

      let sendPath = downloaded.tempPath;
      let sendName = normalizeMp3Name(`${info.rawTitle} - ${info.artist}`);
      let sendMime = downloaded.mimetype;
      let forceDocument = false;

      if (downloaded.isMp3) {
        sendName = downloaded.fileName || sendName;
        sendMime = "audio/mpeg";
      } else {
        try {
          await convertToMp3(downloaded.tempPath, finalMp3Path, { signal: abortSignal });
          sendPath = finalMp3Path;
          sendMime = "audio/mpeg";
        } catch (convertError) {
          console.warn("SPOTIFY conversion fallback:", convertError?.message || convertError);
          sendName = downloaded.fileName || info.fileName;
          sendMime = downloaded.mimetype;
          forceDocument = true;
        }
      }

      throwIfAborted(abortSignal);

      await sendSpotifyAudio(sock, from, quoted, {
        filePath: sendPath,
        fileName: sendName,
        mimetype: sendMime,
        title: info.rawTitle,
        artist: info.artist,
        size: fs.existsSync(sendPath) ? fs.statSync(sendPath).size : downloaded.size,
        forceDocument,
      });
    } catch (error) {
      const aborted = abortSignal?.aborted === true;
      console.error("SPOTIFY ERROR:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        feature: "spotify",
        error: String(error?.message || error || "unknown_error"),
      });
      cooldowns.delete(userId);

      if (aborted) {
        return;
      }

      await sock.sendMessage(
        from,
        {
          text: `❌ ${String(error?.message || "No se pudo procesar el audio de Spotify.")}`,
          ...global.channelInfo,
        },
        quoted
      );
    } finally {
      deleteFileSafe(rawAudioPath);
      deleteFileSafe(finalMp3Path);
    }
  },
};
