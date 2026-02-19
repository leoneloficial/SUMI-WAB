const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { pipeline } = require("stream/promises");

const BOT_NAME = "SonGokuBot";
const API_KEY = "dvyer";
const API_URL = "https://api-adonix.ultraplus.click/download/mediafire";

const MAX_MB = 300; // 🔒 LÍMITE
const TMP_DIR = path.join(process.cwd(), "tmp"); // carpeta temporal del bot
const VIP_FILE = path.join(process.cwd(), "settings", "vip.json");

// ✅ Ajusta la ruta de tu config si está en otro lado
const SETTINGS_PATH = path.join(process.cwd(), "config.json");

// ================= HELPERS: settings/owner =================
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    // fallback por si tu bot guarda settings en global
    return global?.settings || {};
  }
}

function normId(x) {
  return String(x || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/[^\d]/g, "")
    .trim();
}

function getSenderJid(m) {
  return m?.key?.participant || m?.participant || m?.key?.remoteJid || m?.sender || "";
}
function getSenderId(m) {
  return normId(getSenderJid(m));
}

function getOwnersIds(settings) {
  const ids = [];
  if (Array.isArray(settings?.ownerNumbers)) ids.push(...settings.ownerNumbers);
  if (typeof settings?.ownerNumber === "string") ids.push(settings.ownerNumber);

  if (Array.isArray(settings?.ownerLids)) ids.push(...settings.ownerLids);
  if (typeof settings?.ownerLid === "string") ids.push(settings.ownerLid);

  if (typeof settings?.botNumber === "string") ids.push(settings.botNumber);
  return ids.map(normId).filter(Boolean);
}

function isOwner(m, settings) {
  const senderId = getSenderId(m);
  return getOwnersIds(settings).includes(senderId);
}

// ================= HELPERS: VIP (tu formato settings/vip.json) =================
function ensureVipFile() {
  const dir = path.dirname(VIP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(VIP_FILE)) fs.writeFileSync(VIP_FILE, JSON.stringify({ users: {} }, null, 2));
}

function readVip() {
  ensureVipFile();
  try {
    const data = JSON.parse(fs.readFileSync(VIP_FILE, "utf-8"));
    if (!data.users || typeof data.users !== "object") data.users = {};
    return data;
  } catch {
    return { users: {} };
  }
}

function saveVip(data) {
  ensureVipFile();
  fs.writeFileSync(VIP_FILE, JSON.stringify(data, null, 2));
}

function limpiarVip(data) {
  const now = Date.now();
  for (const [num, info] of Object.entries(data.users || {})) {
    if (!info) delete data.users[num];
    else if (typeof info.expiresAt === "number" && now >= info.expiresAt) delete data.users[num];
    else if (typeof info.usesLeft === "number" && info.usesLeft <= 0) delete data.users[num];
  }
}

function getVipInfo(senderId, data) {
  limpiarVip(data);
  const info = data.users?.[senderId];
  if (!info) return null;

  const now = Date.now();
  const expLeft = typeof info.expiresAt === "number" ? info.expiresAt - now : Infinity;
  const usesLeft = typeof info.usesLeft === "number" ? info.usesLeft : Infinity;

  if (expLeft <= 0) return null;
  if (usesLeft <= 0) return null;

  return { info, expLeft, usesLeft };
}

// ================= HELPERS: size/space/tmp =================
function parseSizeMB(sizeStr = "") {
  const s = String(sizeStr).trim().toUpperCase();
  const m = s.match(/^([\d.]+)\s*(KB|MB|GB)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n)) return 0;
  if (unit === "KB") return n / 1024;
  if (unit === "MB") return n;
  if (unit === "GB") return n * 1024;
  return 0;
}

function safeName(name = "archivo") {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").trim() || "archivo";
}

function getFreeSpaceMB() {
  try {
    const out = execSync("df -Pk .").toString().trim().split("\n");
    const cols = out[out.length - 1].split(/\s+/);
    const availableKB = parseInt(cols[3], 10);
    if (!Number.isFinite(availableKB)) return null;
    return availableKB / 1024;
  } catch {
    return null;
  }
}

function guessMime(filename = "") {
  const f = filename.toLowerCase();
  if (f.endsWith(".mp4")) return "video/mp4";
  if (f.endsWith(".mkv")) return "video/x-matroska";
  if (f.endsWith(".mp3")) return "audio/mpeg";
  if (f.endsWith(".pdf")) return "application/pdf";
  if (f.endsWith(".zip")) return "application/zip";
  if (f.endsWith(".rar")) return "application/vnd.rar";
  if (f.endsWith(".7z")) return "application/x-7z-compressed";
  return "application/octet-stream";
}

async function downloadToFile(url, filePath) {
  const resp = await axios.get(url, {
    responseType: "stream",
    timeout: 0,
    headers: { "User-Agent": "Mozilla/5.0" },
    maxRedirects: 5,
  });
  await pipeline(resp.data, fs.createWriteStream(filePath));
  return filePath;
}

// ================= COMMAND =================
module.exports = {
  command: ["mediafire", "mf"],
  categoria: "descarga",
  description: "Descarga archivos de MediaFire y los envía (owner/VIP)",

  run: async (client, m, args) => {
    let filePath;

    try {
      const settings = loadSettings();
      const senderId = getSenderId(m);

      // ✅ Permisos: Owner o VIP
      const owner = isOwner(m, settings);
      const vipData = readVip();
      limpiarVip(vipData);
      saveVip(vipData);

      const vip = owner ? null : getVipInfo(senderId, vipData);
      if (!owner && !vip) {
        return client.reply(
          m.chat,
          "⛔ Solo *OWNER* o usuarios *VIP* pueden usar este comando.",
          m,
          global.channelInfo
        );
      }

      if (!args.length) {
        return client.reply(
          m.chat,
          "❌ Ingresa un enlace de MediaFire.\n\nEjemplo:\n.mf https://www.mediafire.com/file/xxxxx/file",
          m,
          global.channelInfo
        );
      }

      const mfUrl = args[0];

      await client.reply(
        m.chat,
        `📥 *MediaFire Downloader*\n⏳ ${BOT_NAME} está trabajando...`,
        m,
        global.channelInfo
      );

      // ✅ Llamada API
      const api = `${API_URL}?apikey=${API_KEY}&url=${encodeURIComponent(mfUrl)}`;
      const res = await axios.get(api, { timeout: 60000 });

      if (!res.data?.status || !res.data?.result?.link) {
        throw new Error(res.data?.error || "API inválida");
      }

      const file = res.data.result;
      const sizeMB = parseSizeMB(file.size);
      const filename = safeName(file.filename || "archivo");
      const mimetype = guessMime(filename);

      // 🚫 Límite
      if (sizeMB > MAX_MB) {
        return client.sendMessage(
          m.chat,
          {
            text:
              `📁 *MediaFire Downloader*\n\n` +
              `📄 *Archivo:* ${file.filename}\n` +
              `📦 *Tamaño:* ${file.size}\n` +
              `📂 *Tipo:* ${file.filetype}\n\n` +
              `⚠️ *Supera el límite de ${MAX_MB}MB*\n\n` +
              `🔗 Descarga manual:\n${file.link}`,
          },
          { quoted: m, ...global.channelInfo }
        );
      }

      // ✅ Espacio libre (evita ENOSPC)
      if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

      const freeMB = getFreeSpaceMB();
      const NEED_MB = Math.max(200, sizeMB * 2); // margen seguro (temp + procesamiento)
      if (freeMB !== null && freeMB < NEED_MB) {
        return client.sendMessage(
          m.chat,
          {
            text:
              `⚠️ *Sin espacio suficiente en el servidor*\n\n` +
              `📄 *Archivo:* ${file.filename}\n` +
              `📦 *Tamaño:* ${file.size}\n\n` +
              `💾 Libre: *${freeMB.toFixed(0)}MB*\n` +
              `📌 Requerido aprox: *${NEED_MB.toFixed(0)}MB*\n\n` +
              `🔗 Descarga manual:\n${file.link}`,
          },
          { quoted: m, ...global.channelInfo }
        );
      }

      // ✅ Descargar primero (stream)
      filePath = path.join(TMP_DIR, `${Date.now()}_${filename}`);

      await client.reply(
        m.chat,
        `⬇️ Descargando...\n📄 ${file.filename}\n📦 ${file.size}`,
        m,
        global.channelInfo
      );

      await downloadToFile(file.link, filePath);

      // ✅ Enviar como DOCUMENTO desde archivo local
      await client.sendMessage(
        m.chat,
        {
          document: { url: filePath }, // ✅ local file
          fileName: filename,
          mimetype,
          caption:
            `📁 *MediaFire Downloader*\n\n` +
            `📄 *Archivo:* ${file.filename}\n` +
            `📦 *Tamaño:* ${file.size}\n` +
            `📂 *Tipo:* ${file.filetype}\n\n` +
            `🤖 ${BOT_NAME}`,
        },
        { quoted: m, ...global.channelInfo }
      );

      // ✅ Descontar 1 uso VIP SOLO si se envió bien
      if (!owner) {
        const info = vipData.users[senderId];
        if (info && typeof info.usesLeft === "number") {
          info.usesLeft = Math.max(0, info.usesLeft - 1);
          saveVip(vipData);
        }
      }

    } catch (err) {
      console.error("MEDIAFIRE ERROR:", err?.response?.data || err);

      const apiErr = err?.response?.data?.error || err?.message || "";
      await client.reply(
        m.chat,
        `❌ Error al descargar/enviar.\n${apiErr ? `🧩 ${apiErr}` : ""}`,
        m,
        global.channelInfo
      );
    } finally {
      // 🧹 Limpieza
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
  },
};
