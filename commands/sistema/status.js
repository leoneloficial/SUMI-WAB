import fs from "fs";
import path from "path";

function safeJsonParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

function formatUptime(seconds) {
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function getPrefixLabel(settings) {
  const noPrefix = settings?.noPrefix === true;
  const p = settings?.prefix;

  if (noPrefix) return "SIN PREFIJO";
  if (Array.isArray(p) && p.length) return p.join(" | ");
  if (typeof p === "string" && p.trim()) return p.trim();
  return "SIN PREFIJO";
}

function readFileState(filePath, groupId, fallback = false) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = safeJsonParse(raw);

    if (Array.isArray(data)) {
      return data.includes(groupId);
    }

    if (data && typeof data === "object") {
      const entry = data[groupId];
      if (typeof entry === "boolean") return entry;
      if (entry && typeof entry === "object" && "enabled" in entry) {
        return entry.enabled === true;
      }
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function countVipUsers() {
  const vipFile = path.join(process.cwd(), "settings", "vip.json");
  try {
    if (!fs.existsSync(vipFile)) return 0;
    const raw = fs.readFileSync(vipFile, "utf-8");
    const data = safeJsonParse(raw) || {};
    const users = data.users && typeof data.users === "object" ? data.users : {};
    return Object.keys(users).length;
  } catch {
    return 0;
  }
}

function getSubbotLabel() {
  const bots = global.botRuntime?.listBots?.({ includeMain: true }) || [];
  const connected = bots.filter((bot) => bot.connected).length;
  const total = bots.length;
  return `${connected}/${total}`;
}

function buildMainPanel({ settings, comandos, vipCount }) {
  return [
    "╭━━━〔 𝙀𝙎𝙏𝘼𝘿𝙊 𝘿𝙀𝙇 𝘽𝙊𝙏 〕━━━⬣",
    `┃ ⚙️ Bot: *${settings.botName || "BOT"}*`,
    `┃ 👑 Owner: *${settings.ownerName || "Owner"}*`,
    `┃ ⏱️ Uptime: *${formatUptime(process.uptime())}*`,
    `┃ ✦ Prefijos: *${getPrefixLabel(settings)}*`,
    `┃ 🧩 Comandos: *${comandos?.size ?? "?"}*`,
    `┃ 🤖 Bots conectados: *${getSubbotLabel()}*`,
    `┃ 💎 VIP activos: *${vipCount}*`,
    `┃ 📰 Newsletter: *${settings?.newsletter?.enabled ? "ON" : "OFF"}*`,
    "╰━━━━━━━━━━━━━━━━━━━━━━⬣",
  ].join("\n");
}

function buildGroupPanel({ welcomeOn, modoAdmiOn, antilinkOn, antifakeOn }) {
  return [
    "╭─〔 🛡️ 𝙂𝙍𝙐𝙋𝙊 〕",
    `│ 🌸 Welcome: *${welcomeOn ? "ON" : "OFF"}*`,
    `│ 👮 ModoAdmin: *${modoAdmiOn ? "ON" : "OFF"}*`,
    `│ 🔗 Antilink: *${antilinkOn ? "ON" : "OFF"}*`,
    `│ 🚫 Antifake: *${antifakeOn ? "ON" : "OFF"}*`,
    "╰────────────⬣",
  ].join("\n");
}

export default {
  name: "status",
  command: ["status", "estado"],
  category: "sistema",
  description: "Panel de estado del bot",

  run: async ({ sock, msg, from, settings, comandos, esGrupo }) => {
    const dbDir = path.join(process.cwd(), "database");
    const welcomeOn = readFileState(path.join(dbDir, "welcome.json"), from, false);
    const modoAdmiOn = readFileState(path.join(dbDir, "modoadmi.json"), from, false);
    const antilinkOn = readFileState(path.join(dbDir, "antilink.json"), from, false);
    const antifakeOn = readFileState(path.join(dbDir, "antifake.json"), from, false);
    const vipCount = countVipUsers();

    const sections = [
      buildMainPanel({ settings, comandos, vipCount }),
      esGrupo
        ? buildGroupPanel({ welcomeOn, modoAdmiOn, antilinkOn, antifakeOn })
        : [
            "╭─〔 💬 𝙋𝙍𝙄𝙑𝘼𝘿𝙊 〕",
            "│ Este panel fue abierto desde un chat privado.",
            "╰────────────⬣",
          ].join("\n"),
    ];

    return sock.sendMessage(
      from,
      {
        text: sections.join("\n\n"),
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
