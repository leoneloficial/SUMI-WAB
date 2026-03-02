export default {
  command: ["menu", "help", "ayuda"],
  category: "menu",

  run: async (ctx) => {
    const { sock, from, msg } = ctx;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    // ✅ MENÚ TIPO LISTA (CATEGORÍAS)
    await global.enviarLista(sock, from, {
      title: "📂 DVYER MENU",
      text: "Elige una categoría:",
      footer: "DVYER BOT",
      buttonText: "Abrir menú",
      sections: [
        {
          title: "⬇️ Descargas",
          rows: [
            {
              title: "🎬 YouTube MP4",
              description: "Descargar video",
              rowId: ".ytmp4 360p despacito"
            },
            {
              title: "🎵 YouTube MP3",
              description: "Descargar audio",
              rowId: ".ytmp3 despacito"
            }
          ]
        },
        {
          title: "⚙️ Utilidades",
          rows: [
            {
              title: "📌 Ping",
              description: "Ver estado del bot",
              rowId: ".ping"
            },
            {
              title: "🧾 Consola (owner)",
              description: "Ver logs recientes",
              rowId: ".consola 30"
            }
          ]
        }
      ],
      quoted,
    });
  },
};
