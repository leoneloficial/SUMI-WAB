import path from "path";
import {
  API_BASE,
  apiGet,
  deleteFileSafe,
  downloadAbsoluteFile,
  ensureApiKeyConfigured,
  ensureTmpDir,
  getCooldownRemaining,
  isSupportedAppUrl,
  mimeFromFileName,
  normalizeApiUrl,
  normalizePackageFileName,
  pickApiDownloadUrl,
  resolveUserInput,
  safeFileName,
} from "./dvyerShared.js";

const API_APK_SEARCH_URL = `${API_BASE}/apksearch`;
const API_APK_DOWNLOAD_URL = `${API_BASE}/apkdl`;
const COOLDOWN_TIME = 15 * 1000;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const TMP_DIR = ensureTmpDir("apk");
const PREFER_SEQUENCE = ["auto", "apk"];

const cooldowns = new Map();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(query, item) {
  const left = normalizeText(query);
  const title = normalizeText(item?.title || "");
  const packageName = normalizeText(item?.package_name || "");
  const downloadQuery = normalizeText(item?.download_query || "");

  let score = 0;
  if (title === left) score += 300;
  if (packageName === left) score += 260;
  if (downloadQuery === left) score += 240;
  if (title.startsWith(left)) score += 120;
  if (packageName.startsWith(left)) score += 100;
  if (title.includes(left)) score += 80;
  if (packageName.includes(left)) score += 70;
  if (downloadQuery.includes(left)) score += 60;
  return score;
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

async function searchBestApp(query) {
  const data = await apiGet(
    API_APK_SEARCH_URL,
    { q: query, limit: 5, lang: "es" },
    45000
  );

  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) {
    throw new Error("No se encontraron resultados de apps.");
  }

  const best = [...results].sort((a, b) => scoreCandidate(query, b) - scoreCandidate(query, a))[0];

  return {
    title: safeFileName(best?.title || "app"),
    packageName: best?.package_name || null,
    version: best?.version || null,
    versionCode: best?.version_code || null,
    filesizeBytes: best?.filesize_bytes || null,
    icon: best?.icon || null,
    downloadQuery: String(best?.download_query || best?.title || query).trim(),
  };
}

async function requestApkMeta(input, prefer) {
  const params = {
    mode: "link",
    prefer,
    lang: "es",
  };

  if (isSupportedAppUrl(input)) params.url = input;
  else params.q = input;

  const data = await apiGet(API_APK_DOWNLOAD_URL, params, 45000);
  const downloadUrl = normalizeApiUrl(pickApiDownloadUrl(data));

  if (!downloadUrl) {
    throw new Error("La API no devolvio enlace interno de descarga.");
  }

  return {
    title: safeFileName(data?.title || data?.package_name || "app"),
    fileName: normalizePackageFileName(
      data?.filename || "app.apk",
      data?.format || data?.download_type || "apk"
    ),
    packageName: data?.package_name || null,
    version: data?.version || null,
    versionCode: data?.version_code || null,
    format: String(data?.format || data?.download_type || "apk").toLowerCase() || "apk",
    icon: data?.icon || null,
    description: String(data?.description || "").trim() || null,
    filesizeBytes: data?.filesize_bytes || null,
    downloadUrl,
  };
}

async function requestApkMetaWithFallback(input) {
  let lastError = "No se pudo resolver la app.";

  for (const prefer of PREFER_SEQUENCE) {
    try {
      return await requestApkMeta(input, prefer);
    } catch (error) {
      lastError = error?.message || "Error desconocido";
    }
  }

  throw new Error(lastError);
}

function buildPreviewCaption(info) {
  const lines = ["DVYER API", "", `App: ${info.title || "App"}`];
  if (info.version) lines.push(`Version: ${info.version}`);
  if (info.packageName) lines.push(`Paquete: ${info.packageName}`);
  if (info.format) lines.push(`Formato: ${String(info.format).toUpperCase()}`);
  const sizeText = humanBytes(info.filesizeBytes);
  if (sizeText) lines.push(`Tamano: ${sizeText}`);
  if (info.description) {
    lines.push("");
    lines.push(String(info.description).replace(/\s+/g, " ").trim().slice(0, 260));
  }
  return lines.join("\n");
}

async function sendPreviewCard(sock, from, quoted, info) {
  const caption = buildPreviewCaption(info);

  if (info.icon) {
    await sock.sendMessage(
      from,
      {
        image: { url: info.icon },
        caption,
        ...global.channelInfo,
      },
      quoted
    );
    return;
  }

  await sock.sendMessage(
    from,
    {
      text: caption,
      ...global.channelInfo,
    },
    quoted
  );
}

async function sendApkDocument(sock, from, quoted, payload) {
  const { filePath, fileName, mime, title, packageName, version, size, format } = payload;
  const extra = [];
  if (packageName) extra.push(`Paquete: ${packageName}`);
  if (version) extra.push(`Version: ${version}`);
  if (format) extra.push(`Formato: ${String(format).toUpperCase()}`);
  const sizeText = humanBytes(size);
  if (sizeText) extra.push(`Tamano: ${sizeText}`);

  await sock.sendMessage(
    from,
    {
      document: { url: filePath },
      mimetype: mime,
      fileName,
      caption: `DVYER API\n\nApp: ${title}${extra.length ? `\n${extra.join("\n")}` : ""}`,
      ...global.channelInfo,
    },
    quoted
  );
}

export default {
  command: ["apk", "app"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const userId = `${from}:apk`;

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
      ensureApiKeyConfigured();

      const userInput = resolveUserInput(ctx);
      if (!userInput) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "Uso: .apk <nombre de app o url>",
          ...global.channelInfo,
        });
      }

      await sock.sendMessage(
        from,
        {
          text: `Buscando app...\n\nAPI: ${API_BASE}\nConsulta: ${userInput}`,
          ...global.channelInfo,
        },
        quoted
      );

      let searchInfo = null;
      let resolvedInput = userInput;

      if (!isSupportedAppUrl(userInput)) {
        searchInfo = await searchBestApp(userInput);
        resolvedInput = searchInfo.downloadQuery || searchInfo.title || userInput;
      }

      const info = await requestApkMetaWithFallback(resolvedInput);

      await sendPreviewCard(sock, from, quoted, {
        title: info.title || searchInfo?.title,
        packageName: info.packageName || searchInfo?.packageName,
        version: info.version || searchInfo?.version,
        format: info.format,
        filesizeBytes: info.filesizeBytes || searchInfo?.filesizeBytes,
        icon: info.icon || searchInfo?.icon,
        description: info.description,
      });

      tempPath = path.join(
        TMP_DIR,
        `${Date.now()}-${normalizePackageFileName(info.fileName, info.format)}`
      );

      const downloaded = await downloadAbsoluteFile(info.downloadUrl, {
        outputPath: tempPath,
        maxBytes: MAX_FILE_BYTES,
        minBytes: 50000,
      });

      await sendApkDocument(sock, from, quoted, {
        filePath: downloaded.tempPath,
        fileName: normalizePackageFileName(downloaded.fileName || info.fileName, info.format),
        mime: mimeFromFileName(downloaded.fileName || info.fileName),
        title: info.title,
        packageName: info.packageName,
        version: info.version,
        size: downloaded.size,
        format: info.format,
      });
    } catch (error) {
      console.error("APK ERROR:", error?.message || error);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: String(error?.message || "No se pudo procesar la app."),
        ...global.channelInfo,
      });
    } finally {
      deleteFileSafe(tempPath);
    }
  },
};
