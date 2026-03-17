import path from "path";
import {
  API_BASE,
  apiGet,
  deleteFileSafe,
  downloadApiFile,
  ensureTmpDir,
  getCooldownRemaining,
  mimeFromFileName,
  resolveUserInput,
  safeFileName,
} from "./dvyerShared.js";

const API_MEDIAFIRE_URL = `${API_BASE}/mediafire`;
const COOLDOWN_TIME = 15 * 1000;
const MAX_FILE_BYTES = 1500 * 1024 * 1024;
const TMP_DIR = ensureTmpDir("mediafire");

const cooldowns = new Map();

function extractMediaFireUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:[a-z0-9-]+\.)?mediafire\.com\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
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

function normalizeFileName(name) {
  const raw = String(name || "mediafire-file").trim();
  const extMatch = raw.match(/(\.[a-z0-9]{1,10})$/i);
  const ext = extMatch ? extMatch[1] : "";
  const base = safeFileName(raw.replace(/\.[^.]+$/i, "") || "mediafire-file");
  return `${base}${ext}`;
}

async function requestMediafireMeta(fileUrl) {
  const data = await apiGet(
    API_MEDIAFIRE_URL,
    {
      mode: "link",
      url: fileUrl,
    },
    45000
  );

  return {
    title: safeFileName(data?.title || "MediaFire File"),
    fileName: normalizeFileName(data?.filename || "mediafire-file"),
    fileSize: String(data?.filesize || "").trim() || null,
    format: String(data?.format || "").trim() || null,
  };
}

async function sendMediafireDocument(sock, from, quoted, payload) {
  const { filePath, fileName, title, fileSize, size } = payload;
  const lines = ["DVYER API", "", `Archivo: ${title}`];
  if (fileSize) lines.push(`Tamano: ${fileSize}`);
  else {
    const prettySize = humanBytes(size);
    if (prettySize) lines.push(`Tamano: ${prettySize}`);
  }

  await sock.sendMessage(
    from,
    {
      document: { url: filePath },
      mimetype: mimeFromFileName(fileName),
      fileName,
      caption: lines.join("\n"),
      ...global.channelInfo,
    },
    quoted
  );
}

export default {
  command: ["mediafire", "mf"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const userId = `${from}:mediafire`;

    let tempPath = null;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      const rawInput = resolveUserInput(ctx);
      const fileUrl = extractMediaFireUrl(rawInput);

      if (!fileUrl) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "Uso: .mediafire <link publico de MediaFire> o responde a un mensaje con el link",
          ...global.channelInfo,
        });
      }

      await sock.sendMessage(
        from,
        {
          text: `Preparando MediaFire...\n\nAPI: ${API_BASE}`,
          ...global.channelInfo,
        },
        quoted
      );

      const info = await requestMediafireMeta(fileUrl);
      tempPath = path.join(TMP_DIR, `${Date.now()}-${info.fileName}`);

      const downloaded = await downloadApiFile(API_MEDIAFIRE_URL, {
        params: {
          mode: "file",
          url: fileUrl,
        },
        outputPath: tempPath,
        maxBytes: MAX_FILE_BYTES,
        minBytes: 1,
      });

      await sendMediafireDocument(sock, from, quoted, {
        filePath: downloaded.tempPath,
        fileName: normalizeFileName(downloaded.fileName || info.fileName),
        title: info.title,
        fileSize: info.fileSize,
        size: downloaded.size,
      });
    } catch (error) {
      console.error("MEDIAFIRE ERROR:", error?.message || error);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: String(error?.message || "No se pudo procesar el archivo de MediaFire."),
        ...global.channelInfo,
      });
    } finally {
      deleteFileSafe(tempPath);
    }
  },
};
