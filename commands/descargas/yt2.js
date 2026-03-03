import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";

const API_BASE = "https://nexevo.onrender.com/download/y2?url=";

const COOLDOWN_TIME = 15 * 1000;
const TMP_DIR = path.join(process.cwd(), "tmp");

const cooldowns = new Map();
const locks = new Set();

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function getCooldownRemaining(until) {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function safeName(name) {
  return (String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .slice(0, 80) || "video");
}

function isUrl(text) {
  return /^https?:\/\//i.test(text);
}

export default {
  command: ["yt2"],
  category: "descarga",

  run: async ({ sock, from, args, m }) => {

    const quoted = m?.key ? { quoted: m } : undefined;

    if (locks.has(from)) {
      return sock.sendMessage(from, {
        text: "⚠️ Ya estoy procesando otro video aquí...",
        ...global.channelInfo
      });
    }

    const cd = cooldowns.get(from);
    if (cd && cd > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(cd)}s`,
        ...global.channelInfo
      });
    }

    if (!args.length) {
      return sock.sendMessage(from, {
        text: "❌ Uso:\n.yt2 <nombre o link>",
        ...global.channelInfo
      });
    }

    cooldowns.set(from, Date.now() + COOLDOWN_TIME);
    locks.add(from);

    try {

      let query = args.join(" ").trim();
      let videoUrl = query;
      let title = "Video de YouTube";
      let thumbnail = null;

      // 🔎 Si NO es link → buscar en YouTube
      if (!isUrl(query)) {

        await sock.sendMessage(from, {
          text: "🔎 Buscando en YouTube...",
          ...global.channelInfo
        }, quoted);

        const search = await yts(query);
        const first = search?.videos?.[0];

        if (!first) throw new Error("No se encontraron resultados.");

        videoUrl = first.url;
        title = first.title;
        thumbnail = first.thumbnail;
      }

      const api = API_BASE + encodeURIComponent(videoUrl);

      await sock.sendMessage(from, {
        text: "⚡ Conectando con el servidor...",
        ...global.channelInfo
      }, quoted);

      const { data } = await axios.get(api, { timeout: 30000 });

      if (!data?.status || !data?.result?.status) {
        throw new Error("La API no devolvió resultado válido.");
      }

      const result = data.result;
      const info = result.info || {};

      title = safeName(info.title || title);
      thumbnail = info.thumbnail || thumbnail;
      const quality = result.quality || 360;
      const directUrl = result.url;

      // 📸 Enviar miniatura
      if (thumbnail) {
        await sock.sendMessage(from, {
          image: { url: thumbnail },
          caption:
`━━━━━━━━━━━━━━━
🎬 ${title}
📺 Calidad: ${quality}p
⏳ Descargando...
━━━━━━━━━━━━━━━`,
          ...global.channelInfo
        }, quoted);
      }

      // 🎥 Enviar video
      try {
        await sock.sendMessage(from, {
          video: { url: directUrl },
          mimetype: "video/mp4",
          caption:
`✅ Descarga completada
🎬 ${title}
📺 ${quality}p`,
          ...global.channelInfo
        }, quoted);

      } catch {

        await sock.sendMessage(from, {
          document: { url: directUrl },
          mimetype: "video/mp4",
          fileName: `${title}.mp4`,
          caption:
`📁 Enviado como documento
🎬 ${title}
📺 ${quality}p`,
          ...global.channelInfo
        }, quoted);
      }

    } catch (err) {

      cooldowns.delete(from);

      await sock.sendMessage(from, {
        text: `❌ Error: ${err.message}`,
        ...global.channelInfo
      });

    } finally {
      locks.delete(from);
    }
  }
};