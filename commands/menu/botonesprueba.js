export default {
  name: "botonesprueba",
  command: ["botonesprueba", "buttonstest", "btnprueba"],
  category: "menu",
  description: "Prueba de botones clasicos",

  run: async ({ sock, msg, from, usedPrefix = "." }) => {
    try {
      console.log(`BOTONES PRUEBA SEND chat=${from}`);

      await sock.sendMessage(
        from,
        {
          text:
            "Prueba de botones\n\n" +
            "Toca uno de los botones para comprobar si tu WhatsApp los muestra bien.",
          footer: "Fsociety bot",
          buttons: [
            {
              buttonId: `${usedPrefix}ping`,
              buttonText: { displayText: "Ping" },
              type: 1,
            },
            {
              buttonId: `${usedPrefix}status`,
              buttonText: { displayText: "Status" },
              type: 1,
            },
            {
              buttonId: `${usedPrefix}menu`,
              buttonText: { displayText: "Menu" },
              type: 1,
            },
          ],
          headerType: 1,
        },
        { quoted: msg }
      );

      console.log(`BOTONES PRUEBA OK chat=${from}`);
    } catch (error) {
      console.error("BOTONES PRUEBA ERROR:", error);
      await sock.sendMessage(
        from,
        {
          text: `No pude enviar la prueba de botones.\n\n${error?.message || error}`,
        },
        { quoted: msg }
      );
    }
  },
};
