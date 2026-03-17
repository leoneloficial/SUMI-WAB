import { formatDuration } from "./_shared.js";

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

export default {
  name: "cola",
  command: ["cola", "queue"],
  category: "sistema",
  description: "Muestra descargas activas por bot",

  run: async ({ sock, msg, from, esOwner }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const runtime = global.botRuntime;
    const bots = (runtime?.listBots?.({ includeMain: true }) || []).filter(
      (bot) => bot.downloadQueueActive || Number(bot.activeDownloadCount || 0) > 0
    );

    await sock.sendMessage(
      from,
      {
        text:
          `*COLA / DESCARGAS ACTIVAS*\n\n` +
          `${
            bots.length
              ? bots
                  .map(
                    (bot) =>
                      `*${bot.label}*\n` +
                      `Activas: ${Number(bot.activeDownloadCount || 0)}\n` +
                      `Procesando: ${bot.currentDownloadCommand || "Sin detalle"}\n` +
                      `Tiempo: ${formatDuration(bot.currentDownloadRunningForMs || 0)}`
                  )
                  .join("\n\n")
              : "No hay descargas activas ahora mismo."
          }`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );
  },
};
