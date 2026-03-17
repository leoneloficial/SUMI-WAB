import * as baileys from "@whiskeysockets/baileys";
import { buildDvyerUrl, getDvyerBaseUrl } from "../../lib/api-manager.js";

const { downloadContentFromMessage } = baileys;

const API_HD_UPLOAD_URL = buildDvyerUrl("/image/hd/upload");
const API_HD_URL = buildDvyerUrl("/image/hd");
const COOLDOWN_TIME = 15 * 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const cooldowns = new Map();

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function unwrapMessage(message = {}) {
  let current = message;

  while (current?.ephemeralMessage?.message) {
    current = current.ephemeralMessage.message;
  }

  while (current?.viewOnceMessage?.message) {
    current = current.viewOnceMessage.message;
  }

  while (current?.viewOnceMessageV2?.message) {
    current = current.viewOnceMessageV2.message;
  }

  while (current?.viewOnceMessageV2Extension?.message) {
    current = current.viewOnceMessageV2Extension.message;
  }

  return current || {};
}

function safeFileName(name) {
  return (
    String(name || "imagen")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "imagen"
  );
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

function normalizeImageName(name, fallback = "imagen-hd", format = "jpg") {
  const raw = String(name || "").trim();
  const base = safeFileName(raw.replace(/\.[^.]+$/i, "") || fallback);
  const normalizedExt = String(format || "jpg").replace(/^\./, "").toLowerCase();
  return `${base}.${normalizedExt}`;
}

function extractTextFromMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    ""
  );
}

function resolveDirectUrl(args = [], msg) {
  const argsText = Array.isArray(args) ? args.join(" ").trim() : "";
  const quotedText = extractTextFromMessage(msg?.quoted?.message || {});
  const source = argsText || quotedText || "";
  const match = String(source || "").match(/https?:\/\/[^\s]+/i);
  return match ? match[0].trim() : "";
}

function parseCommandOptions(args = []) {
  let scale = 2;
  let format = "auto";

  for (const raw of Array.isArray(args) ? args : []) {
    const value = String(raw || "").trim().toLowerCase();

    if (value === "2" || value === "4") {
      scale = Number(value);
      continue;
    }

    if (["auto", "jpg", "jpeg", "png", "webp"].includes(value)) {
      format = value === "jpeg" ? "jpg" : value;
    }
  }

  return { scale, format };
}

function humanBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size || size < 1) return null;

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

async function readResponseError(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(text);
    return parsed?.detail || parsed?.message || text;
  } catch {
    return text;
  }
}

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function downloadQuotedImageBuffer(msg) {
  const quotedMessage = unwrapMessage(msg?.quoted?.message || {});
  const directMessage = unwrapMessage(msg?.message || {});
  const imageMessage = quotedMessage?.imageMessage || directMessage?.imageMessage || null;

  if (!imageMessage) {
    return null;
  }

  const stream = await downloadContentFromMessage(imageMessage, "image");
  const buffer = await streamToBuffer(stream);

  if (!buffer.length) {
    throw new Error("No pude leer la imagen.");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("La imagen es demasiado grande para procesarla.");
  }

  return {
    buffer,
    mimeType: String(imageMessage?.mimetype || "image/jpeg").trim().toLowerCase() || "image/jpeg",
    caption: extractTextFromMessage(quotedMessage) || extractTextFromMessage(directMessage) || "",
  };
}

async function enhanceFromUpload(imageBuffer, options = {}) {
  const mimeType = String(options.mimeType || "image/jpeg").trim().toLowerCase() || "image/jpeg";
  const uploadName = normalizeImageName(
    options.fileName || "imagen",
    "imagen",
    mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"
  );
  const form = new FormData();

  form.append("file", new Blob([imageBuffer], { type: mimeType }), uploadName);
  form.append("mode", "file");
  form.append("scale", String(options.scale || 2));
  form.append("format", String(options.format || "auto"));

  const response = await fetch(API_HD_UPLOAD_URL, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const outputBuffer = Buffer.from(await response.arrayBuffer());
  if (!outputBuffer.length) {
    throw new Error("La API devolvio una imagen vacia.");
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").trim().toLowerCase();
  const fileName =
    parseContentDispositionFileName(response.headers.get("content-disposition")) ||
    normalizeImageName(
      options.fileName || "imagen-hd",
      "imagen-hd",
      contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
    );

  return {
    buffer: outputBuffer,
    contentType,
    fileName,
  };
}

async function enhanceFromUrl(imageUrl, options = {}) {
  const params = new URLSearchParams({
    mode: "file",
    url: imageUrl,
    scale: String(options.scale || 2),
    format: String(options.format || "auto"),
  });

  const response = await fetch(`${API_HD_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const outputBuffer = Buffer.from(await response.arrayBuffer());
  if (!outputBuffer.length) {
    throw new Error("La API devolvio una imagen vacia.");
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").trim().toLowerCase();
  const fileName =
    parseContentDispositionFileName(response.headers.get("content-disposition")) ||
    normalizeImageName(
      "imagen-hd",
      "imagen-hd",
      contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
    );

  return {
    buffer: outputBuffer,
    contentType,
    fileName,
  };
}

export default {
  name: "hd",
  command: ["hd", "remini"],
  category: "media",
  description: "Mejora una imagen en HD",

  run: async ({ sock, msg, from, args = [] }) => {
    const quoted = getQuoted(msg);
    const userId = `${from}:hd`;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(
        from,
        {
          text: `Espera ${getCooldownRemaining(until)}s`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      const { scale, format } = parseCommandOptions(args);
      const directUrl = resolveDirectUrl(args, msg);
      const quotedImage = await downloadQuotedImageBuffer(msg);

      if (!quotedImage && !directUrl) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text:
              "*USO HD*\n\n" +
              "Responde a una imagen o manda una URL publica.\n" +
              "Ejemplos:\n" +
              ".hd\n" +
              ".hd 4 png\n" +
              ".remini respondiendo a una imagen",
            ...global.channelInfo,
          },
          quoted
        );
      }

      await sock.sendMessage(
        from,
        {
          text:
            "*MEJORANDO IMAGEN*\n\n" +
            `Escala: x${scale}\n` +
            `Formato: ${format.toUpperCase()}\n` +
            `API: ${getDvyerBaseUrl()}`,
          ...global.channelInfo,
        },
        quoted
      );

      const sourceName = safeFileName(
        quotedImage?.caption?.slice(0, 40) ||
          (directUrl ? "imagen-url" : "imagen")
      );

      const result = directUrl
        ? await enhanceFromUrl(directUrl, { scale, format })
        : await enhanceFromUpload(quotedImage.buffer, {
            fileName: sourceName,
            mimeType: quotedImage.mimeType,
            scale,
            format,
          });

      const sizeText = humanBytes(result.buffer.length);
      const caption = ["DVYER API", "", `Imagen HD x${scale}`];

      if (sizeText) {
        caption.push(`Tamano: ${sizeText}`);
      }

      if (result.contentType.startsWith("image/") && !result.contentType.includes("webp")) {
        return sock.sendMessage(
          from,
          {
            image: result.buffer,
            caption: caption.join("\n"),
            ...global.channelInfo,
          },
          quoted
        );
      }

      return sock.sendMessage(
        from,
        {
          document: result.buffer,
          mimetype: result.contentType || "application/octet-stream",
          fileName: result.fileName || "imagen-hd.jpg",
          caption: caption.join("\n"),
          ...global.channelInfo,
        },
        quoted
      );
    } catch (error) {
      console.error("HD ERROR:", error);
      cooldowns.delete(userId);

      return sock.sendMessage(
        from,
        {
          text: `No pude mejorar la imagen.\n\n${error?.message || "Error desconocido."}`,
          ...global.channelInfo,
        },
        quoted
      );
    }
  },
};
