import { getWeeklySnapshot } from "../../lib/weekly.js";
import { formatUserLabel } from "../economia/_shared.js";
import { formatChatLabel } from "./_shared.js";

export default {
  name: "semanal",
  command: ["semanal", "weekly", "ranksemanal"],
  category: "sistema",
  description: "Ranking semanal de comandos, juegos y dolares",

  run: async ({ sock, msg, from, args = [] }) => {
    const mode = String(args[0] || "comandos").trim().toLowerCase();
    const snapshot = getWeeklySnapshot(10);

    let body = "";

    if (mode === "coins" || mode === "dolares" || mode === "usd") {
      body =
        `*TOP SEMANAL DOLARES*\n\n` +
        snapshot.topUsersByCoins
          .map((item, index) => `${index + 1}. ${formatUserLabel(item.id)} - US$ ${item.coins}`)
          .join("\n");
    } else if (mode === "juegos") {
      body =
        `*TOP SEMANAL JUEGOS*\n\n` +
        snapshot.topUsersByGames
          .map((item, index) => `${index + 1}. ${formatUserLabel(item.id)} - ${item.games} partidas / ${item.wins} wins`)
          .join("\n");
    } else {
      body =
        `*TOP SEMANAL COMANDOS*\n\n` +
        snapshot.topUsersByCommands
          .map((item, index) => `${index + 1}. ${formatUserLabel(item.id)} - ${item.commands} comandos`)
          .join("\n") +
        `\n\n*TOP GRUPOS*\n` +
        snapshot.topChats.map((item, index) => `${index + 1}. ${formatChatLabel(item.id)} - ${item.commands}`).join("\n");
    }

    return sock.sendMessage(
      from,
      {
        text: `${body}\n\nSemana: ${snapshot.weekKey}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
