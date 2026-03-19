import {
  formatCoins,
  formatUserLabel,
  getDownloadRequestState,
  getEconomyConfig,
  getEconomyProfile,
} from "./_shared.js";

export default {
  name: "dolares",
  command: ["dolares", "saldo", "usd", "dinero", "coins", "balance", "wallet", "cartera", "misdolares"],
  category: "economia",
  description: "Muestra tus dolares, solicitudes e inventario",

  run: async ({ sock, msg, from, sender, settings, esOwner }) => {
    const profile = getEconomyProfile(sender, settings);
    const requests = getDownloadRequestState(sender, settings);
    const config = getEconomyConfig(settings);
    const inventoryLines = Object.entries(profile?.inventory || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([itemId, count]) => `- ${itemId}: ${count}`);

    await sock.sendMessage(
      from,
      {
        text:
          `*ECONOMIA DE ${formatUserLabel(sender)}*\n\n` +
          `Nombre: *${profile?.lastKnownName || "Sin nombre"}*\n` +
          `Numero: *${profile?.phone ? `+${profile.phone}` : formatUserLabel(sender)}*\n` +
          `Dolares: *${formatCoins(profile?.coins || 0)}*\n` +
          `Banco: *${formatCoins(profile?.bank || 0)}*\n` +
          `Total actual: *${formatCoins(Number(profile?.coins || 0) + Number(profile?.bank || 0))}*\n` +
          `Ganado total: *${formatCoins(profile?.totalEarned || 0)}*\n` +
          `Gastado total: *${formatCoins(profile?.totalSpent || 0)}*\n\n` +
          `Solicitudes hoy: *${requests?.dailyRemaining || 0}/${requests?.dailyLimit || 0}*\n` +
          `Solicitudes extra: *${requests?.extraRemaining || 0}*\n` +
          `Solicitudes usadas: *${requests?.totalConsumed || 0}*\n` +
          `Cobro de descargas: *${esOwner ? "EXENTO OWNER" : config.downloadBillingEnabled ? "ACTIVO" : "APAGADO"}*\n\n` +
          `Inventario:\n${inventoryLines.length ? inventoryLines.join("\n") : "- Vacio"}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
