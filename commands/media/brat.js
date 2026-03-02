export default {
  name: "brat",
  command: ["brat", "bratimg"],
  category: "media",
  desc: "Genera una imagen estilo brat con texto. Uso: .brat <texto> | <color>",

  run: async ({ sock, msg, from, args, settings }) => {

    const input = args.join(" ").trim();

    if (!input) {
      return sock.sendMessage(
        from,
        { text: `❌ Uso:\n${settings.prefix}brat <texto> | <color>\nEjemplo:\n${settings.prefix}brat Hola mundo | black`, ...global.channelInfo },
        { quoted: msg }
      );
    }

    try {

      // separar texto y color
      const parts = input.split("|");
      const text = parts[0]?.trim() || "hola";
      const bg = parts[1]?.trim() || "white";

      const url =
        `https://api.soymaycol.icu/api/canvas/bratimage?text=${encodeURIComponent(text)}&bg=${encodeURIComponent(bg)}`;

      await sock.sendMessage(
        from,
        {
          image: { url },
          caption: `🖼️ Imagen generada\n\nTexto: ${text}\nFondo: ${bg}`,
          ...global.channelInfo
        },
        { quoted: msg }
      );

    } catch (e) {

      console.error("brat error:", e);

      await sock.sendMessage(
        from,
        { text: "❌ Error generando la imagen.", ...global.channelInfo },
        { quoted: msg }
      );
    }
  },
};
