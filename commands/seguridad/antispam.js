const antispamOn = new Set();
// Map key: `${from}|${sender}` -> { times: number[], strikes: number }
const spamMap = new Map();

const WINDOW_MS = 8000; // 8s
const LIMIT = 6;        // 6 mensajes en 8s
const MAX_STRIKES = 2;  // a la 3ra vez lo expulsa (si el bot puede)

export default {
  command: ["antispam"],
  category: "seguridad",
  description: "Anti spam (on/off)",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args }) => {
    const op = (args[0] || "").toLowerCase();
    if (!op) {
      const st = antispamOn.has(from) ? "ON ✅" : "OFF ❌";
      return sock.sendMessage(
        from,
        { text: `⚙️ Estado antispam: *${st}*\nUso: .antispam on / .antispam off`, ...global.channelInfo },
        { quoted: msg }
      );
    }

    if (op === "on") {
      antispamOn.add(from);
      return sock.sendMessage(from, { text: "✅ Antispam activado.", ...global.channelInfo }, { quoted: msg });
    }
    if (op === "off") {
      antispamOn.delete(from);
      return sock.sendMessage(from, { text: "✅ Antispam desactivado.", ...global.channelInfo }, { quoted: msg });
    }

    return sock.sendMessage(from, { text: "❌ Usa on/off", ...global.channelInfo }, { quoted: msg });
  },

  onMessage: async ({ sock, msg, from, esGrupo, esAdmin, esOwner }) => {
    if (!esGrupo) return;
    if (!antispamOn.has(from)) return;

    const sender = msg.key.participant;
    if (!sender) return;

    // no castigar admins/owner
    if (esAdmin || esOwner) return;

    const key = `${from}|${sender}`;
    const now = Date.now();

    const data = spamMap.get(key) || { times: [], strikes: 0 };
    data.times = data.times.filter((t) => now - t <= WINDOW_MS);
    data.times.push(now);

    if (data.times.length >= LIMIT) {
      data.strikes += 1;
      data.times = [];

      // borrar el mensaje que disparó el spam
      try {
        await sock.sendMessage(from, { delete: msg.key, ...global.channelInfo });
      } catch {}

      if (data.strikes > MAX_STRIKES) {
        // expulsar si se puede
        try {
          await sock.groupParticipantsUpdate(from, [sender], "remove");
          await sock.sendMessage(from, {
            text: `🚫 Antispam: @${sender.split("@")[0]} expulsado.`,
            mentions: [sender],
            ...global.channelInfo
          });
        } catch {
          await sock.sendMessage(from, {
            text: `⚠️ Antispam: @${sender.split("@")[0]} spameando (no pude expulsar).`,
            mentions: [sender],
            ...global.channelInfo
          });
        }
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ Antispam: @${sender.split("@")[0]} baja el spam. (strike ${data.strikes}/${MAX_STRIKES + 1})`,
          mentions: [sender],
          ...global.channelInfo
        });
      }
    }

    spamMap.set(key, data);
  }
};
