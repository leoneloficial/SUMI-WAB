import os from "os";
import { formatBytes, formatDuration } from "./_shared.js";

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

export default {
  name: "procesos",
  command: ["procesos", "ram"],
  category: "sistema",
  description: "Muestra memoria, CPU y bots activos",

  run: async ({ sock, msg, from, esOwner }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const runtime = global.botRuntime;
    const bots = runtime?.listBots?.({ includeMain: true }) || [];
    const mem = process.memoryUsage();
    const activeBots = bots.filter((bot) => bot.connected).length;
    const runningDownloads = bots.reduce((sum, bot) => sum + Number(bot.activeDownloadCount || 0), 0);

    await sock.sendMessage(
      from,
      {
        text:
          `*PROCESOS DEL BOT*\n\n` +
          `PID: *${process.pid}*\n` +
          `Node: *${process.version}*\n` +
          `CPU cores: *${os.cpus().length}*\n` +
          `RAM proceso: *${formatBytes(mem.rss)}*\n` +
          `Heap usado: *${formatBytes(mem.heapUsed)}*\n` +
          `RAM libre sistema: *${formatBytes(os.freemem())}*\n` +
          `RAM total sistema: *${formatBytes(os.totalmem())}*\n` +
          `Uptime: *${formatDuration(process.uptime() * 1000)}*\n` +
          `Bots conectados: *${activeBots}/${bots.length}*\n` +
          `Descargas activas: *${runningDownloads}*`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );
  },
};
