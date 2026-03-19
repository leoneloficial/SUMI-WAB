import { formatCoins, formatUserLabel, getTopCoins } from "./_shared.js";

export default {
  name: "topdolares",
  command: ["topdolares", "rankdolares", "topcoins", "coinstop", "rankcoins", "rankdolaressemana"],
  category: "economia",
  description: "Muestra el ranking de dolares",

  run: async ({ sock, msg, from }) => {
    const leaderboard = getTopCoins(10);

    await sock.sendMessage(
      from,
      {
        text:
          `*TOP DOLARES*\n\n` +
          `${leaderboard.length
            ? leaderboard
                .map(
                  (entry, index) =>
                    `${index + 1}. ${formatUserLabel(entry.id)} - *${formatCoins(entry.total)}*`
                )
                .join("\n")
            : "Todavia no hay jugadores con dolares."}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
