import { claimDaily, formatCoins, getPrefix } from "./_shared.js";
import { formatDuration } from "../sistema/_shared.js";

export default {
  name: "daily",
  command: ["daily", "coinsdaily", "reclamarcoins"],
  category: "economia",
  description: "Reclama tu recompensa diaria",

  run: async ({ sock, msg, from, sender, settings }) => {
    const result = claimDaily(sender);
    const prefix = getPrefix(settings);

    if (!result.ok) {
      return sock.sendMessage(
        from,
        {
          text:
            `*DAILY EN COOLDOWN*\n\n` +
            `Podras reclamar de nuevo en *${formatDuration(result.remainingMs)}*.\n` +
            `Mientras tanto revisa tu saldo con *${prefix}coins*.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    await sock.sendMessage(
      from,
      {
        text:
          `*DAILY RECLAMADO*\n\n` +
          `Ganaste *${formatCoins(result.amount)}*.\n` +
          `Usa *.shop* para ver la tienda.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
