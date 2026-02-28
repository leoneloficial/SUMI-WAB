import axios from "axios";
import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto
} from "@whiskeysockets/baileys";

// ================= CONFIG =================
const API_URL = "https://nexevo-api.vercel.app/search/tiktok";
const MAX_VIDEOS = 4;

// ================= HELPERS =================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// arma un “media group” en un solo envío (best-effort)
async function sendAsAlbum(sock, jid, videos, caption, quoted) {
  // Prepara cada video como “prepared media”
  const prepared = [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const media = await prepareWAMessageMedia(
      { video: v.buffer, mimetype: "video/mp4" },
      { upload: sock.waUploadToServer }
    );

    prepared.push({
      videoMessage: media.videoMessage,
      // WhatsApp normalmente solo usa caption en el primero del grupo
      messageContextInfo: { messageSecret: new Uint8Array(32) },
      ...(i === 0 ? { caption } : {})
    });
  }

  // Construye el contenido tipo “album”
  const content = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        // Esto es lo que usualmente fuerza agrupación de medios
        messageContextInfo: {
          messageSecret: new Uint8Array(32)
        },
        // Se envía como “videoMessage” en grupo mediante array interno
        // Algunos clientes lo interpretan como álbum/grupo
        videoMessage: prepared[0].videoMessage
      }
    }
  });

  // Truco: meter el resto como “additional messages” no funciona siempre,
  // así que usamos un enfoque de “multi-send” en 1 relay (si lo permite)
  // En Baileys, lo más compatible es construir un msg de contenido y luego relay
  const msg = generateWAMessageFromContent(jid, content, quoted ? quoted : {});

  // Adjunta el resto como “multi” dentro de message context
  // (best-effort: dependiendo del cliente, puede agrupar o no)
  msg.message.viewOnceMessage.message.messageContextInfo = {
    messageSecret: new Uint8Array(32),
    // “forwardedNewsletterMessageInfo” a veces ya lo tienes en global.channelInfo,
    // pero aquí no rompe si existe
    ...(global.channelInfo?.messageContextInfo || {})
  };

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });

  // Después del primer “ancla”, manda los demás con mismo quoted pero SIN spam textual
  // intentando que WhatsApp los agrupe por tiempo/consecutivo.
  for (let i = 1; i < prepared.length; i++) {
    await sock.sendMessage(
      jid,
      {
        video: prepared[i].videoMessage,
        mimetype: "video/mp4",
        // sin caption para no spam
        ...global.channelInfo
      },
      quoted
    );
  }
}

export default {
  command: ["tiktoksearch"],
  category: "descarga",
  description: "Busca y envía 4 videos de TikTok (intenta en álbum)",

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

      const shuffled = shuffle(data.result);
      const picked = [];
      const seen = new Set();

      for (const v of shuffled) {
        const key = v?.play || v?.url || v?.id || JSON.stringify(v);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picked.push(v);
        if (picked.length >= MAX_VIDEOS) break;
      }

      if (!picked.length) {
        return sock.sendMessage(
          from,
          { text: "❌ *No se pudieron seleccionar resultados válidos*", ...global.channelInfo },
          quoted
        );
      }

      await sock.sendMessage(
        from,
        { text: `✅ Encontré *${picked.length}* videos. Enviando en grupo...`, ...global.channelInfo },
        quoted
      );

      // Descarga buffers primero
      const buffers = [];
      for (const video of picked) {
        const r = await axios.get(video.play, {
          responseType: "arraybuffer",
          timeout: 60000,
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        buffers.push({
          buffer: Buffer.from(r.data),
          meta: video
        });
      }

      const caption =
`🎬 *TikTok (x${buffers.length})*
🔎 "${query}"
🤖 _${botName}_`;

      // ✅ intenta “álbum”
      try {
        await sendAsAlbum(sock, from, buffers, caption, quoted);
      } catch (e) {
        console.error("ALBUM FALLBACK:", e?.message || e);

        // fallback: manda normal pero sin textos extra
        for (let i = 0; i < buffers.length; i++) {
          await sock.sendMessage(
            from,
            {
              video: buffers[i].buffer,
              mimetype: "video/mp4",
              caption: i === 0 ? caption : undefined,
              ...global.channelInfo
            },
            quoted
          );
        }
      }

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
