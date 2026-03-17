import fs from "fs";
import path from "path";

const USAGE_STATS_FILE = path.join(process.cwd(), "database", "usage-stats.json");

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

function readUsageStats() {
  try {
    if (!fs.existsSync(USAGE_STATS_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(USAGE_STATS_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

export default {
  name: "broadcast",
  command: ["broadcast", "bc"],
  category: "sistema",
  description: "Envia un mensaje global a grupos o privados",

  run: async ({ sock, msg, from, args = [], esOwner }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const mode = String(args[0] || "all").trim().toLowerCase();
    const text =
      ["all", "grupos", "groups", "privados", "private"].includes(mode)
        ? String(args.slice(1).join(" ") || "").trim()
        : String(args.join(" ") || "").trim();

    if (!text) {
      return sock.sendMessage(
        from,
        {
          text:
            "*USO BROADCAST*\n\n" +
            ".broadcast all mensaje\n" +
            ".broadcast grupos mensaje\n" +
            ".broadcast privados mensaje",
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const usage = readUsageStats();
    const knownChats = Object.keys(usage.chatUsage || {});
    const privateChats = knownChats.filter((chatId) => chatId.endsWith("@s.whatsapp.net"));
    const groups = Object.keys((await sock.groupFetchAllParticipating()) || {});

    const targets =
      mode === "grupos" || mode === "groups"
        ? groups
        : mode === "privados" || mode === "private"
          ? privateChats
          : unique([...groups, ...privateChats]);

    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      try {
        await sock.sendMessage(
          target,
          {
            text: `*BROADCAST DEL OWNER*\n\n${text}`,
            ...global.channelInfo,
          },
          undefined
        );
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch {
        failed += 1;
      }
    }

    await sock.sendMessage(
      from,
      {
        text:
          `*BROADCAST TERMINADO*\n\n` +
          `Modo: *${mode}*\n` +
          `Enviados: *${sent}*\n` +
          `Fallidos: *${failed}*`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );
  },
};
