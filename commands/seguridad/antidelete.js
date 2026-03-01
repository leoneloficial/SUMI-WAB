const antiDeleteOn = new Set();

// cache simple: chat -> Map(messageId -> { sender, text, message, ts })
const cacheByChat = new Map();
const MAX_PER_CHAT = 80;

function extractText(m) {
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    null
  );
}

export default {
  command: ["antidelete", "ad"],
  category: "seguridad",
  description: "Reenvía mensajes borrados (on/off)",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args }) => {
    const op = (args[0] || "").toLowerCase();
    if (!op) {
      const st = antiDeleteOn.has(from) ? "ON ✅" : "OFF ❌";
      return sock.sendMessage(
        from,
        { text: `⚙️ Estado antidelete: *${st}*\nUso: .antidelete on / .antidelete off`, ...global.channelInfo },
        { quoted: msg }
      );
    }

    if (op === "on") {
      antiDeleteOn.add(from);
      return sock.sendMessage(from, { text: "✅ Antidelete activado.", ...global.channelInfo }, { quoted: msg });
    }
    if (op === "off") {
      antiDeleteOn.delete(from);
      return sock.sendMessage(from, { text: "✅ Antidelete desactivado.", ...global.channelInfo }, { quoted: msg });
    }

    return sock.sendMessage(from, { text: "❌ Usa on/off", ...global.channelInfo }, { quoted: msg });
  },

  onMessage: async ({ sock, msg, from, esGrupo }) => {
    if (!esGrupo) return;

    // 1) guardar mensajes normales en cache
    const id = msg.key?.id;
    const sender = msg.key?.participant || msg.key?.remoteJid;
    if (id && msg.message && !msg.message?.protocolMessage) {
      const chatMap = cacheByChat.get(from) || new Map();
      chatMap.set(id, {
        sender,
        text: extractText(msg.message),
        message: msg.message,
        ts: Date.now()
      });

      // recortar
      if (chatMap.size > MAX_PER_CHAT) {
        const firstKey = chatMap.keys().next().value;
        chatMap.delete(firstKey);
      }
      cacheByChat.set(from, chatMap);
    }

    // 2) detectar borrado (REVOKE)
    const proto = msg.message?.protocolMessage;
    if (!proto) return;
    if (!antiDeleteOn.has(from)) return;

    // En Baileys, delete suele venir como protocolMessage con key del mensaje borrado
    const revokedKey = proto?.key;
    const revokedId = revokedKey?.id;
    if (!revokedId) return;

    const chatMap = cacheByChat.get(from);
    const saved = chatMap?.get(revokedId);
    if (!saved) {
      return sock.sendMessage(from, { text: "🕵️ Antidelete: borraron algo pero no alcancé a guardarlo.", ...global.channelInfo });
    }

    const who = saved.sender ? `@${saved.sender.split("@")[0]}` : "Alguien";
    const text = saved.text ? `\n\n📝 *Texto:* ${saved.text}` : "";

    // reenviar lo que se pueda
    try {
      await sock.sendMessage(from, {
        text: `🕵️ *Antidelete*\n👤 *Autor:* ${who}${text}`,
        mentions: saved.sender ? [saved.sender] : [],
        ...global.channelInfo
      });

      // si era media, reenviamos el mensaje guardado “tal cual”
      // (a veces no se puede si era efímero, pero normalmente funciona)
      if (saved.message?.imageMessage || saved.message?.videoMessage || saved.message?.documentMessage || saved.message?.audioMessage) {
        await sock.sendMessage(from, { forward: { key: revokedKey, message: saved.message } });
      }
    } catch (e) {
      console.error("antidelete resend error:", e);
    }
  }
};
