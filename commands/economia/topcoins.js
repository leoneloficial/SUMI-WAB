import { formatCoins, formatUserLabel, getTopCoins } from "./_shared.js";

export default {
  name: "topcoins",
  command: ["topcoins", "coinstop", "rankcoins"],
  category: "economia",
  description: "Muestra el ranking de coins",

  run: async ({ sock, msg, from }) => {
    const leaderboard = getTopCoins(10);

    await sock.sendMessage(
      from,
      {
        text:
          `*TOP COINS*\n\n` +
          `${leaderboard.length
            ? leaderboard
                .map(
                  (entry, index) =>
                    `${index + 1}. ${formatUserLabel(entry.id)} - *${formatCoins(entry.coins)}*`
                )
                .join("\n")
            : "Todavia no hay jugadores con coins."}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
