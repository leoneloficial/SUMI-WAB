import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "database", "group-activity.json");

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

function readStore() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export default {
  name: "leavegc",
  command: ["leavegc"],
  category: "sistema",
  description: "Sale de grupos inactivos y registra actividad",

  async run({ sock, msg, from, args = [], esOwner }) {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const action = String(args[0] || "").trim().toLowerCase();
    if (action !== "inactive") {
      return sock.sendMessage(
        from,
        {
          text: "Usa: *.leavegc inactive 30*",
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const inactiveDays = Math.max(1, Number(args[1] || 30));
    const threshold = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
    const store = readStore();
    const groups = await sock.groupFetchAllParticipating();
    const candidates = Object.keys(groups || {}).filter(
      (groupId) => {
        const lastActivityAt = Number(store[groupId]?.lastActivityAt || 0);
        return lastActivityAt > 0 && lastActivityAt < threshold;
      }
    );

    let left = 0;
    for (const groupId of candidates) {
      try {
        await sock.groupLeave(groupId);
        left += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch {}
    }

    await sock.sendMessage(
      from,
      {
        text:
          `*LEAVEGC INACTIVE*\n\n` +
          `Dias sin actividad: *${inactiveDays}*\n` +
          `Grupos revisados: *${Object.keys(groups || {}).length}*\n` +
          `Grupos abandonados: *${left}*`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );
  },

  async onMessage({ from, esGrupo, sender, text }) {
    if (!esGrupo) return false;

    const store = readStore();
    store[from] = {
      lastActivityAt: Date.now(),
      lastSender: String(sender || ""),
      preview: String(text || "").trim().slice(0, 80),
    };
    saveStore(store);
    return false;
  },
};
