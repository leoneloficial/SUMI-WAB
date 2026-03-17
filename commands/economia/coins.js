import {
  formatCoins,
  formatUserLabel,
  getEconomyProfile,
} from "./_shared.js";

export default {
  name: "coins",
  command: ["coins", "balance", "wallet", "cartera"],
  category: "economia",
  description: "Muestra tus coins e inventario",

  run: async ({ sock, msg, from, sender }) => {
    const profile = getEconomyProfile(sender);
    const inventoryLines = Object.entries(profile?.inventory || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([itemId, count]) => `- ${itemId}: ${count}`);

    await sock.sendMessage(
      from,
      {
        text:
          `*ECONOMIA DE ${formatUserLabel(sender)}*\n\n` +
          `Coins: *${formatCoins(profile?.coins || 0)}*\n` +
          `Ganado total: *${formatCoins(profile?.totalEarned || 0)}*\n` +
          `Gastado total: *${formatCoins(profile?.totalSpent || 0)}*\n\n` +
          `Inventario:\n${inventoryLines.length ? inventoryLines.join("\n") : "- Vacio"}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
