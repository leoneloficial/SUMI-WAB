import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { exec } from "child_process";

const API_BASE = "https://dv-yer-api.online";
const API_URL = `${API_BASE}/ytmp3`;

const COOLDOWN_TIME = 10 * 1000;
const TMP_DIR = path.join(process.cwd(), "tmp");
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const AUDIO_QUALITY = "128k";

const cooldowns = new Map();

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function safeFileName(name) {
  return String(name || "audio")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function toAbsoluteUrl(urlLike) {
  if (!urlLike) return "";
  if (/^https?:\/\//i.test(urlLike)) return urlLike;
  return new URL(urlLike, API_BASE).href;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Obtener link directo desde tu API
async function fetchDirectMediaUrl({ videoUrl }) {
  let lastError = "No se pudo obtener el audio.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(API_URL, {
        timeout: 35000,
        params: {
          url: videoUrl,
          mode: "link",
          quality: AUDIO_QUALITY,
        },
        validateStatus: () => true,
      });

      const data = response.data;

      if (response.status >= 400) {
        throw new Error(
          data?.detail ||
            data?.error?.message ||
            data?.message ||
            `HTTP ${response.status}`
        );
      }

      if (data?.ok === false || data?.status === false) {
        throw new Error(
          data?.detail ||
            data?.error?.message ||
            data?.message ||
            "La API devolvió error."
        );
      }

      const candidateUrl =
        data?.download_url_full ||
        data?.download_url ||
        data?.url ||
        data?.result?.download_url_full ||
        data?.result?.download_url ||
        data?.result?.url;

      if (!candidateUrl) {
        throw new Error("La API no devolvió URL de descarga.");
      }

      return {
        title: data?.title || data?.result?.title || "audio",
        directUrl: toAbsoluteUrl(candidateUrl),
      };
    } catch (error) {
      lastError = error?.message || "Error desconocido";
      await sleep(900 * attempt);
    }
  }

  throw new Error(lastError);
}

// Convertir a MP3 con ffmpeg
async function convertToMp3(inputUrl, outputPath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -y -i "${inputUrl}" -vn -ab 128k -ar 44100 -loglevel error "${outputPath}"`,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export default {
  command: ["ytmp3", "play"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    const userId = from;
    let finalMp3;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((until - Date.now()) / 1000)}s`,
        ...global.channelInfo,
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    const quoted = msg?.key ? { quoted: msg } : undefined;

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp3 <nombre o link>",
          ...global.channelInfo,
        });
      }

      const query = args.join(" ").trim();
      let videoUrl = query;
      let title = "audio";
      let thumbnail = null;

      finalMp3 = path.join(TMP_DIR, `${Date.now()}.mp3`);

      // Si no es link, buscar en YouTube
      if (!isHttpUrl(query)) {
        const search = await yts(query);
        const first = search?.videos?.[0];

        if (!first) {
          cooldowns.delete(userId);
          return sock.sendMessage(from, {
            text: "❌ No se encontró.",
            ...global.channelInfo,
          });
        }

        videoUrl = first.url;
        title = safeFileName(first.title);
        thumbnail = first.thumbnail;
      }

      // Obtener info desde API
      const info = await fetchDirectMediaUrl({ videoUrl });
      title = safeFileName(info.title);

      // Si no hay thumbnail, intentar obtenerla
      if (!thumbnail) {
        try {
          const search = await yts(videoUrl);
          const first = search?.videos?.[0];
          if (first) thumbnail = first.thumbnail;
        } catch {}
      }

      // Mensaje previo
      if (thumbnail) {
        await sock.sendMessage(
          from,
          {
            image: { url: thumbnail },
            caption: `🎵 Descargando música...\n\n🎧 ${title}`,
            ...global.channelInfo,
          },
          quoted
        );
      } else {
        await sock.sendMessage(
          from,
          {
            text: `🎵 Descargando música...\n\n🎧 ${title}`,
            ...global.channelInfo,
          },
          quoted
        );
      }

      // Convertir a mp3
      await convertToMp3(info.directUrl, finalMp3);

      const size = fs.existsSync(finalMp3)
        ? fs.statSync(finalMp3).size
        : 0;

      if (!size || size < 100000) {
        throw new Error("Audio inválido");
      }

      if (size > MAX_AUDIO_BYTES) {
        throw new Error("Audio demasiado grande");
      }

      // Enviar como audio real
      await sock.sendMessage(
        from,
        {
          audio: { url: finalMp3 },
          mimetype: "audio/mpeg",
          ptt: false,
          fileName: `${title}.mp3`,
          ...global.channelInfo,
        },
        quoted
      );
    } catch (err) {
      console.error("YTMP3 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ ${err?.message || "Error al procesar la música."}`,
        ...global.channelInfo,
      });
    } finally {
      try {
        if (finalMp3 && fs.existsSync(finalMp3)) {
          fs.unlinkSync(finalMp3);
        }
      } catch {}
    }
  },
};

