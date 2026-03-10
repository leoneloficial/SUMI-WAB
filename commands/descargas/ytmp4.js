import axios from "axios";
import yts from "yt-search";

const API_BASE = "https://dv-yer-api.online";
const API_VIDEO_URL = `${API_BASE}/ytmp4`;
const API_SEARCH_URL = `${API_BASE}/ytsearch`;

const COOLDOWN_TIME = 15 * 1000;
const VIDEO_QUALITY = "360p";
const cooldowns = new Map();

function safeFileName(name) {
  return (
    String(name || "video")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video"
  );
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function getYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
    const v = u.searchParams.get("v");
    if (v) return v.trim();

    const parts = u.pathname.split("/").filter(Boolean);
    const idxShorts = parts.indexOf("shorts");
    if (idxShorts >= 0 && parts[idxShorts + 1]) return parts[idxShorts + 1].trim();

    const idxEmbed = parts.indexOf("embed");
    if (idxEmbed >= 0 && parts[idxEmbed + 1]) return parts[idxEmbed + 1].trim();

    return null;
  } catch {
    return null;
  }
}

function toAbsoluteUrl(urlLike) {
  if (!urlLike) return "";
  if (/^https?:\/\//i.test(urlLike)) return urlLike;
  return new URL(urlLike, API_BASE).href;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestDownloadUrl(data) {
  return (
    data?.download_url_full ||
    data?.download_url ||
    data?.url ||
    data?.result?.download_url_full ||
    data?.result?.download_url ||
    data?.result?.url ||
    ""
  );
}

function pickTitle(data, fallback = "video") {
  return data?.title || data?.result?.title || fallback;
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

async function apiGet(url, params, timeout = 45000) {
  const response = await axios.get(url, {
    timeout,
    params,
    validateStatus: () => true,
  });

  const data = response.data;

  if (response.status >= 400) {
    throw new Error(extractApiError(data, response.status));
  }

  if (data?.ok === false || data?.status === false) {
    throw new Error(extractApiError(data, response.status));
  }

  return data;
}

async function resolveVideoInfo(queryOrUrl) {
  if (!isHttpUrl(queryOrUrl)) {
    try {
      const data = await apiGet(API_SEARCH_URL, { q: queryOrUrl, limit: 1 }, 25000);
      const first = data?.results?.[0];
      if (first?.url) {
        return {
          videoUrl: first.url,
          title: safeFileName(first.title),
          thumbnail: first.thumbnail || null,
        };
      }
    } catch {}

    const search = await yts(queryOrUrl);
    const first = search?.videos?.[0];
    if (!first) return null;

    return {
      videoUrl: first.url,
      title: safeFileName(first.title),
      thumbnail: first.thumbnail || null,
    };
  }

  const videoId = getYoutubeId(queryOrUrl);
  if (videoId) {
    try {
      const info = await yts({ videoId });
      if (info?.url) {
        return {
          videoUrl: info.url,
          title: safeFileName(info.title),
          thumbnail: info.thumbnail || null,
        };
      }
    } catch {}
  }

  return {
    videoUrl: queryOrUrl,
    title: "video",
    thumbnail: null,
  };
}

async function requestVideoLink(videoUrl) {
  let lastError = "No se pudo obtener el video.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await apiGet(API_VIDEO_URL, {
        mode: "link",
        quality: VIDEO_QUALITY,
        url: videoUrl,
      });

      const directUrl = toAbsoluteUrl(pickBestDownloadUrl(data));
      if (!directUrl) {
        throw new Error("La API no devolvió URL de descarga.");
      }

      return {
        title: pickTitle(data, "video"),
        directUrl,
      };
    } catch (error) {
      lastError = error?.message || "Error desconocido";
      await sleep(1200 * attempt);
    }
  }

  throw new Error(lastError);
}

async function sendVideoByUrl(sock, from, quoted, { directUrl, title }) {
  try {
    await sock.sendMessage(
      from,
      {
        video: { url: directUrl },
        mimetype: "video/mp4",
        caption: `🎬 ${title}`,
        ...global.channelInfo,
      },
      quoted
    );
    return "video";
  } catch (e1) {
    console.error("send video by url failed:", e1?.message || e1);

    await sock.sendMessage(
      from,
      {
        document: { url: directUrl },
        mimetype: "video/mp4",
        fileName: `${title}.mp4`,
        caption: `📄 Enviado como documento\n🎬 ${title}`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }
}

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const userId = from;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp4 <nombre o link>",
          ...global.channelInfo,
        });
      }

      const query = args.join(" ").trim();

      if (!query) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Debes poner un nombre o link.",
          ...global.channelInfo,
        });
      }

      const meta = await resolveVideoInfo(query);

      if (!meta) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ No se encontró el video.",
          ...global.channelInfo,
        });
      }

      let { videoUrl, title, thumbnail } = meta;

      await sock.sendMessage(
        from,
        thumbnail
          ? {
              image: { url: thumbnail },
              caption: `⬇️ Preparando video...\n\n🎬 ${title}\n🎚️ Calidad: ${VIDEO_QUALITY}`,
              ...global.channelInfo,
            }
          : {
              text: `⬇️ Preparando video...\n\n🎬 ${title}\n🎚️ Calidad: ${VIDEO_QUALITY}`,
              ...global.channelInfo,
            },
        quoted
      );

      const info = await requestVideoLink(videoUrl);
      title = safeFileName(info.title || title);

      await sendVideoByUrl(sock, from, quoted, {
        directUrl: info.directUrl,
        title,
      });
    } catch (err) {
      console.error("YTMP4 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ ${String(err?.message || "Error al procesar el video.")}`,
        ...global.channelInfo,
      });
    }
  },
};
