import { searchTikTokVideos } from "./_searchFallbacks.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

export default {
  name: "ttsearch",
  command: ["ttsearch", "ttksearch", "tts", "tiktoksearch"],
  category: "descarga",
  description: "Busca videos de TikTok y envia 2 resultados",

  run: async (ctx) => {
    const { sock, msg, from, args, settings } = ctx;
    const q = args.join(" ").trim();
    const prefix = getPrefix(settings);

    if (!q) {
      return sock.sendMessage(
        from,
        {
          text: `Uso:\n${prefix}ttksearch <texto>\nEj: ${prefix}ttsearch edit goku`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    let downloadCharge = null;

    try {
      const results = await searchTikTokVideos(q, 2);

      if (!results.length) {
        return sock.sendMessage(
          from,
          {
            text: "No encontre resultados de TikTok.",
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      downloadCharge = await chargeDownloadRequest(ctx, {
        commandName: "tiktoksearch",
        query: q,
        totalResults: results.length,
      });

      if (!downloadCharge.ok) {
        return null;
      }

      for (const item of results) {
        await sock.sendMessage(
          from,
          {
            video: { url: item.play },
            caption:
              `*${item.title || "Video TikTok"}*\n` +
              `@${item.author || "usuario"}\n` +
              `Fuente: ${item.source || "tiktok"}`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }
    } catch (error) {
      console.error("Error ejecutando ttsearch:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        commandName: "tiktoksearch",
        reason: error?.message || "search_error",
      });

      await sock.sendMessage(
        from,
        {
          text: "Error obteniendo videos de TikTok.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }
  },
};
