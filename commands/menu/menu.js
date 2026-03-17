import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getPrimaryPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function getPrefixLabel(settings) {
  if (Array.isArray(settings?.prefix)) {
    const values = settings.prefix
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return values.length ? values.join(" | ") : ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function normalizeCategoryLabel(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .trim()
    .toUpperCase();
}

function getCategoryIcon(category = "") {
  const key = String(category || "").trim().toLowerCase();
  const icons = {
    admin: "👑",
    ai: "🧠",
    anime: "🌸",
    busqueda: "🔎",
    descarga: "📥",
    descargas: "📥",
    economia: "💰",
    grupo: "🛡️",
    juegos: "🎮",
    menu: "📜",
    sistema: "⚙️",
    subbots: "🤖",
    vip: "💎",
  };

  return icons[key] || "✦";
}

function buildTopPanel({ settings, uptime, totalCategories, totalCommands, prefixLabel }) {
  return [
    "╭━━━〔 𝙈𝙀𝙉𝙐 𝙋𝙍𝙄𝙉𝘾𝙄𝙋𝘼𝙇 〕━━━⬣",
    `┃ ✦ Bot: *${settings.botName || "BOT"}*`,
    `┃ ✦ Owner: *${settings.ownerName || "Owner"}*`,
    `┃ ✦ Prefijos: *${prefixLabel}*`,
    `┃ ✦ Uptime: *${uptime}*`,
    `┃ ✦ Categorias: *${totalCategories}*`,
    `┃ ✦ Comandos: *${totalCommands}*`,
    "╰━━━━━━━━━━━━━━━━━━━━━━⬣",
  ].join("\n");
}

function buildCategoryBlock(category, commands, primaryPrefix) {
  const icon = getCategoryIcon(category);
  const title = normalizeCategoryLabel(category);
  const lines = [
    `╭─〔 ${icon} ${title} 〕`,
    ...commands.map((name) => `│ • \`${primaryPrefix}${name}\``),
    "╰────────────⬣",
  ];

  return lines.join("\n");
}

function buildFooter(primaryPrefix) {
  return [
    "╭─〔 𝙉𝙊𝙏𝘼𝙎 〕",
    `│ • Usa \`${primaryPrefix}status\` para ver el estado del bot`,
    `│ • Usa \`${primaryPrefix}owner\` si necesitas soporte directo`,
    "╰────────────⬣",
  ].join("\n");
}

export default {
  command: ["menu"],
  category: "menu",
  description: "Menu principal con diseno premium",

  run: async ({ sock, msg, from, settings, comandos }) => {
    try {
      if (!comandos) {
        return sock.sendMessage(
          from,
          { text: "❌ error interno", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const videoPath = path.join(process.cwd(), "videos", "menu-video.mp4");
      if (!fs.existsSync(videoPath)) {
        return sock.sendMessage(
          from,
          { text: "❌ video del menu no encontrado", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const uptime = formatUptime(process.uptime());
      const primaryPrefix = getPrimaryPrefix(settings);
      const prefixLabel = getPrefixLabel(settings);
      const categorias = {};

      for (const cmd of new Set(comandos.values())) {
        if (!cmd?.category || !cmd?.command) continue;

        const cat = String(cmd.category).toLowerCase();
        const principal = cmd.name || (Array.isArray(cmd.command) ? cmd.command[0] : cmd.command);
        if (!principal) continue;

        if (!categorias[cat]) categorias[cat] = new Set();
        categorias[cat].add(String(principal).toLowerCase());
      }

      const categoryNames = Object.keys(categorias).sort();
      const totalCommands = categoryNames.reduce(
        (sum, category) => sum + Array.from(categorias[category]).length,
        0
      );

      const parts = [
        buildTopPanel({
          settings,
          uptime,
          totalCategories: categoryNames.length,
          totalCommands,
          prefixLabel,
        }),
        ...categoryNames.map((category) =>
          buildCategoryBlock(category, Array.from(categorias[category]).sort(), primaryPrefix)
        ),
        buildFooter(primaryPrefix),
      ];

      await sock.sendMessage(
        from,
        {
          video: fs.readFileSync(videoPath),
          mimetype: "video/mp4",
          gifPlayback: true,
          caption: parts.join("\n\n").trim(),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error("MENU ERROR:", err);
      await sock.sendMessage(
        from,
        { text: "❌ error al mostrar el menu", ...global.channelInfo },
        { quoted: msg }
      );
    }
  },
};
