function normalizarNumero(x) {
  return String(x || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/[^\d]/g, "")
    .trim();
}

export default {
  name: "whoami",
  command: ["whoami"],
  category: "admin",

  run: async ({ sock, msg, from, settings }) => {
    const senderJid = msg?.key?.participant || msg?.participant || msg?.key?.remoteJid || from;
    const senderNum = normalizarNumero(senderJid);

    const owners = Array.isArray(settings?.ownerNumbers) ? settings.ownerNumbers : [];
    const ownersNorm = owners.map(normalizarNumero);

    await sock.sendMessage(
      from,
      {
        text:
          `🧾 *WHOAMI*\n\n` +
          `📌 senderJid: ${String(senderJid)}\n` +
          `📌 senderNum: ${senderNum}\n\n` +
          `👑 owners: ${JSON.stringify(owners)}\n` +
          `👑 ownersNorm: ${JSON.stringify(ownersNorm)}\n\n` +
          `✅ esOwner: ${ownersNorm.includes(senderNum)}`,
      },
      { quoted: msg }
    );
  },
};
