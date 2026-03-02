import axios from "axios";

export default {
  name: "tiktoksearch",
  command: ["ttsearch", "tiktoksearch", "tks", "tsearch"],
  category: "descargas",
  desc: "Busca videos en TikTok. Uso: .ttsearch <texto>",

  run: async ({ sock, msg, from, args, settings }) => {
    const q = args.join(" ").trim();
    if (!q) {
      return sock.sendMessage(
        from,
        { text: `❌ Uso:\n${settings.prefix}ttsearch <texto>\nEj: ${settings.prefix}ttsearch edit goku`, ...global.channelInfo },
        { quoted: msg }
      );
    }

    try {
      const url = `https://nexevo.onrender.com/search/tiktok?q=${encodeURIComponent(q)}`;
      const { data } = await axios.get(url, { timeout: 60000 });

      if (!data?.status || !Array.isArray(data?.result) || data.result.length === 0) {
        return sock.sendMessage(
          from,
          { text: "❌ No encontré resultados.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const results = data.result.slice(0, 5);

      let text = `🔎 *TikTok Search*\n📌 *Query:* ${q}\n\n`;

      results.forEach((v, i) => {
        const title = (v.title || "Sin título").trim();
        const dur = typeof v.duration === "number" ? `${v.duration}s` : "—";
        const views = v.play_count ? `${v.play_count}` : "—";
        const author = v?.author?.unique_id ? `@${v.author.unique_id}` : "—";

        text +=
          `*${i + 1}.* ${title}\n` +
          `👤 ${author} | ⏱ ${dur} | 👁 ${views}\n` +
          `▶️ *Sin marca:* ${v.play}\n` +
          `💧 *Con marca:* ${v.wmplay}\n\n`;
      });

      text += `✅ Tip: copia el link "Sin marca" para verlo/descargarlo en tu navegador.\n`;

      // Enviar solo texto (y opcional: miniatura del primer resultado)
      const firstCover = results[0]?.cover;

      if (firstCover) {
        return sock.sendMessage(
          from,
          { image: { url: firstCover }, caption: text, ...global.channelInfo },
          { quoted: msg }
        );
      }

      return sock.sendMessage(from, { text, ...global.channelInfo }, { quoted: msg });
    } catch (e) {
      console.error("tiktoksearch error:", e?.message || e);
      return sock.sendMessage(
        from,
        { text: "❌ Error consultando la API de TikTok.", ...global.channelInfo },
        { quoted: msg }
      );
    }
  },
};
