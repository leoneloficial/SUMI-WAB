import axios from "axios";

// ================= CONFIG =================
const API_URL = "https://nexevo-api.vercel.app/search/tiktok";
const MAX_VIDEOS = 4;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default {
  command: ["tiktoksearch"],
  category: "descarga",
  description: "Busca y envía 4 videos de TikTok en álbum",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;

    try {
      const query = args.join(" ").trim();
      const botName = settings?.botName || "Bot";

      if (!query) {
        return sock.sendMessage(
          from,
          {
            text:
`❌ *Falta el texto de búsqueda*

📌 _Ejemplo:_
\`.tiktoksearch goku\``,
            ...global.channelInfo
          },
          quoted
        );
      }

      await sock.sendMessage(
        from,
        {
          text:
`🔎 *Buscando en TikTok...*
▸ "${query}"

🤖 _${botName}_`,
          ...global.channelInfo
        },
        quoted
      );

      const { data } = await axios.get(
        `${API_URL}?q=${encodeURIComponent(query)}`,
        { timeout: 20000 }
      );

      if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
        return sock.sendMessage(
          from,
          { text: "❌ *No se encontraron resultados*", ...global.channelInfo },
          quoted
        );
      }

      // escoger hasta 4 resultados únicos
      const shuffled = shuffle(data.result);
      const picked = [];
      const seen = new Set();

      for (const v of shuffled) {
        const key = v?.play || v?.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picked.push(v);
        if (picked.length >= MAX_VIDEOS) break;
      }

      if (picked.length === 0) {
        return sock.sendMessage(
          from,
          { text: "❌ *No se pudieron seleccionar resultados válidos*", ...global.channelInfo },
          quoted
        );
      }

      // descargar buffers
      const mediaItems = [];
      for (let i = 0; i < picked.length; i++) {
        const video = picked[i];

        const videoRes = await axios.get(video.play, {
          responseType: "arraybuffer",
          timeout: 60000,
          headers: { "User-Agent": "Mozilla/5.0" }
        });

        const videoBuffer = Buffer.from(videoRes.data);

        mediaItems.push({
          video: videoBuffer,
          mimetype: "video/mp4",
          // solo el primero con caption (WhatsApp álbum normalmente usa 1 caption)
          caption:
            i === 0
              ? `🎬 *TikTok álbum* (${picked.length} videos)\n\n🔎 "${query}"\n🤖 _${botName}_`
              : undefined
        });
      }

      // ✅ ENVIAR COMO ÁLBUM
      await sock.sendMessage(
        from,
        {
          albumMessage: mediaItems,
          ...global.channelInfo
        },
        quoted
      );

    } catch (err) {
      console.error("TIKTOK SEARCH ERROR:", err?.message || err);
      await sock.sendMessage(
        from,
        { text: "❌ *Error al buscar en TikTok*", ...global.channelInfo },
        quoted
      );
    }
  }
};
