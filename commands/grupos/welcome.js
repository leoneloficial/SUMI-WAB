import fs from "fs";
import path from "path";

const DB_DIR = path.join(process.cwd(), "database");
const FILE = path.join(DB_DIR, "welcome.json");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function readStore() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    if (!parsed || typeof parsed !== "object") return {};

    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.map((groupId) => [groupId, { enabled: true }]));
    }

    return parsed;
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

function getConfig(groupId) {
  const store = readStore();
  if (!store[groupId]) {
    store[groupId] = {
      enabled: false,
      text: "",
      rules: "",
      image: "",
    };
    saveStore(store);
  }
  return store[groupId];
}

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

async function fetchImageBuffer(url = "") {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`No pude descargar la imagen (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export default {
  name: "welcome",
  command: ["welcome"],
  groupOnly: true,
  adminOnly: true,
  category: "grupo",
  description: "Bienvenida premium con imagen, reglas y texto personalizado",

  async run({ sock, from, args = [], msg, settings }) {
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const store = readStore();
    const config = getConfig(from);
    const action = String(args[0] || "status").trim().toLowerCase();
    const value = String(args.slice(1).join(" ") || "").trim();
    const prefix = getPrefix(settings);

    if (!args.length || action === "status") {
      return sock.sendMessage(
        from,
        {
          text:
            `*WELCOME PREMIUM*\n\n` +
            `Estado: *${config.enabled ? "ON" : "OFF"}*\n` +
            `Imagen: *${config.image ? "CONFIGURADA" : "NO"}*\n` +
            `Reglas: *${config.rules ? "SI" : "NO"}*\n` +
            `Texto custom: *${config.text ? "SI" : "NO"}*\n\n` +
            `${prefix}welcome on\n` +
            `${prefix}welcome off\n` +
            `${prefix}welcome text Bienvenido a nuestro grupo\n` +
            `${prefix}welcome rules Nada de spam | Respeta | Lee fijados\n` +
            `${prefix}welcome image https://...\n` +
            `${prefix}welcome reset`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "on") {
      store[from] = { ...config, enabled: true };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Welcome premium activado.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "off") {
      store[from] = { ...config, enabled: false };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Welcome premium desactivado.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "text") {
      store[from] = { ...config, text: value.slice(0, 400) };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Texto de bienvenida actualizado.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "rules") {
      store[from] = { ...config, rules: value.slice(0, 400) };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Reglas de bienvenida actualizadas.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "image") {
      store[from] = { ...config, image: value };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Imagen de bienvenida guardada.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "reset") {
      store[from] = {
        enabled: false,
        text: "",
        rules: "",
        image: "",
      };
      saveStore(store);
      return sock.sendMessage(
        from,
        {
          text: "Welcome premium reiniciado.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    return sock.sendMessage(
      from,
      {
        text: "Opcion invalida. Usa .welcome status para ver la ayuda.",
        ...global.channelInfo,
      },
      quoted
    );
  },

  async onGroupUpdate({ sock, update, settings }) {
    if (!update?.id || update.action !== "add") return;

    const config = getConfig(update.id);
    if (!config.enabled) return;

    let metadata = null;
    try {
      metadata = await sock.groupMetadata(update.id);
    } catch {}

    const groupName = metadata?.subject || "Grupo";
    const totalMembers = Array.isArray(metadata?.participants) ? metadata.participants.length : 0;
    const botName = String(settings?.botName || "Bot").trim() || "Bot";

    for (const participant of update.participants || []) {
      const userTag = `@${String(participant).split("@")[0].split(":")[0]}`;
      const customText = config.text
        ? `\n\n${config.text}`
        : `\n\nBienvenido a *${groupName}*.`;
      const rulesBlock = config.rules
        ? `\n\n*REGLAS RAPIDAS*\n${config.rules}`
        : "";
      const caption =
        `*WELCOME PREMIUM*\n\n` +
        `Hola ${userTag}\n` +
        `Grupo: *${groupName}*\n` +
        `Miembro #: *${Math.max(1, totalMembers)}*\n` +
        `Bot activo: *${botName}*` +
        `${customText}` +
        `${rulesBlock}\n\n` +
        `Comandos utiles:\n` +
        `${getPrefix(settings)}menu\n` +
        `${getPrefix(settings)}owner`;

      if (config.image) {
        try {
          const imageBuffer = await fetchImageBuffer(config.image);
          await sock.sendMessage(update.id, {
            image: imageBuffer,
            caption,
            mentions: [participant],
            ...global.channelInfo,
          });
          continue;
        } catch {}
      }

      await sock.sendMessage(update.id, {
        text: caption,
        mentions: [participant],
        ...global.channelInfo,
      });
    }
  },
};
