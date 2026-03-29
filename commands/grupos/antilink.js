import fs from "fs";
import path from "path";
import {
  getParticipantDisplayTag,
  getParticipantMentionJid,
  runGroupParticipantAction,
} from "../../lib/group-compat.js";

const DB_DIR = path.join(process.cwd(), "database");
const FILE = path.join(DB_DIR, "antilink.json");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function normalizeDomain(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled === true,
    mode: String(source.mode || "kick").trim().toLowerCase() === "delete" ? "delete" : "kick",
    allowWhatsapp: source.allowWhatsapp !== false,
    whitelist: Array.isArray(source.whitelist)
      ? source.whitelist.map((item) => normalizeDomain(item)).filter(Boolean)
      : [],
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf-8");
    const data = safeParse(raw);

    if (Array.isArray(data)) {
      return Object.fromEntries(
        data.map((groupId) => [String(groupId), normalizeConfig({ enabled: true })])
      );
    }

    if (!data || typeof data !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(data).map(([groupId, config]) => [groupId, normalizeConfig(config)])
    );
  } catch {
    return {};
  }
}

function saveStore() {
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

function getGroupConfig(groupId) {
  const key = String(groupId || "").trim();
  if (!store[key]) {
    store[key] = normalizeConfig();
  }
  return store[key];
}

function extractLinks(text = "") {
  const matches = String(text || "").match(
    /((?:https?:\/\/|www\.)[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+)/gi
  );

  return (matches || []).map((value) => {
    const raw = String(value || "").trim();
    const normalized = normalizeDomain(raw);
    const isWhatsapp =
      normalized.includes("chat.whatsapp.com") || normalized.startsWith("wa.me");

    return {
      raw,
      domain: normalized,
      isWhatsapp,
    };
  });
}

function isAllowedLink(link, config) {
  if (!link?.domain) return true;
  if (link.isWhatsapp && config.allowWhatsapp) return true;
  return config.whitelist.some(
    (domain) => link.domain === domain || link.domain.endsWith(`.${domain}`)
  );
}

let store = loadStore();

export default {
  name: "antilink",
  command: ["antilink"],
  groupOnly: true,
  adminOnly: true,
  category: "grupo",
  description: "Protege grupos contra links con whitelist y modos configurables",

  async run({ sock, from, args = [], msg }) {
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const config = getGroupConfig(from);
    const action = String(args[0] || "status").trim().toLowerCase();
    const value = String(args.slice(1).join(" ") || "").trim();

    if (!args.length || ["status", "estado"].includes(action)) {
      return sock.sendMessage(
        from,
        {
          text:
            `*ANTILINK*\n\n` +
            `Estado: *${config.enabled ? "ON" : "OFF"}*\n` +
            `Modo: *${config.mode.toUpperCase()}*\n` +
            `WhatsApp links: *${config.allowWhatsapp ? "PERMITIDOS" : "BLOQUEADOS"}*\n` +
            `Whitelist: ${config.whitelist.length ? config.whitelist.join(", ") : "vacia"}\n\n` +
            `Uso:\n` +
            `.antilink on\n` +
            `.antilink off\n` +
            `.antilink mode delete\n` +
            `.antilink mode kick\n` +
            `.antilink allow whatsapp\n` +
            `.antilink deny whatsapp\n` +
            `.antilink allow youtube.com\n` +
            `.antilink remove youtube.com\n` +
            `.antilink list`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "on") {
      config.enabled = true;
      saveStore();
      return sock.sendMessage(
        from,
        {
          text: "Anti-link activado para este grupo.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "off") {
      config.enabled = false;
      saveStore();
      return sock.sendMessage(
        from,
        {
          text: "Anti-link desactivado para este grupo.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "mode") {
      const mode = String(args[1] || "").trim().toLowerCase();
      if (!["delete", "kick"].includes(mode)) {
        return sock.sendMessage(
          from,
          {
            text: "Usa: .antilink mode delete o .antilink mode kick",
            ...global.channelInfo,
          },
          quoted
        );
      }

      config.mode = mode;
      saveStore();
      return sock.sendMessage(
        from,
        {
          text: `Modo anti-link actualizado a *${mode.toUpperCase()}*.`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "allow") {
      const target = String(args[1] || "").trim().toLowerCase();
      if (target === "whatsapp" || target === "wa") {
        config.allowWhatsapp = true;
        saveStore();
        return sock.sendMessage(
          from,
          {
            text: "Los enlaces de WhatsApp quedaron permitidos.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const domain = normalizeDomain(value);
      if (!domain) {
        return sock.sendMessage(
          from,
          {
            text: "Usa: .antilink allow dominio.com",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (!config.whitelist.includes(domain)) {
        config.whitelist.push(domain);
        config.whitelist.sort();
        saveStore();
      }

      return sock.sendMessage(
        from,
        {
          text: `Dominio permitido: *${domain}*`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "deny") {
      const target = String(args[1] || "").trim().toLowerCase();
      if (target === "whatsapp" || target === "wa") {
        config.allowWhatsapp = false;
        saveStore();
        return sock.sendMessage(
          from,
          {
            text: "Los enlaces de WhatsApp quedaron bloqueados.",
            ...global.channelInfo,
          },
          quoted
        );
      }
    }

    if (action === "remove" || action === "del") {
      const domain = normalizeDomain(value);
      if (!domain) {
        return sock.sendMessage(
          from,
          {
            text: "Usa: .antilink remove dominio.com",
            ...global.channelInfo,
          },
          quoted
        );
      }

      config.whitelist = config.whitelist.filter((item) => item !== domain);
      saveStore();
      return sock.sendMessage(
        from,
        {
          text: `Dominio removido de la whitelist: *${domain}*`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (action === "list") {
      return sock.sendMessage(
        from,
        {
          text:
            `*WHITELIST ANTILINK*\n\n` +
            `${config.whitelist.length ? config.whitelist.map((item) => `• ${item}`).join("\n") : "Sin dominios permitidos."}`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    return sock.sendMessage(
      from,
      {
        text: "Opcion invalida. Usa .antilink status para ver la ayuda.",
        ...global.channelInfo,
      },
      quoted
    );
  },

  async onMessage({ sock, msg, from, esGrupo, esAdmin, esOwner, esBotAdmin, groupMetadata }) {
    if (!esGrupo) return;

    const config = getGroupConfig(from);
    if (!config.enabled) return;

    const texto =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption;

    if (!texto) return;
    if (esAdmin || esOwner) return;

    const links = extractLinks(texto);
    const blockedLink = links.find((link) => !isAllowedLink(link, config));

    if (!blockedLink) return;

    const sender = msg.sender || msg.key?.participant;
    if (!sender) return;
    const mentionJid = getParticipantMentionJid(groupMetadata || {}, null, sender);

    try {
      await sock.sendMessage(from, { delete: msg.key, ...global.channelInfo });
    } catch {}

    if (config.mode === "kick" && esBotAdmin) {
      try {
        const removeResult = await runGroupParticipantAction(
          sock,
          from,
          groupMetadata || {},
          null,
          [sender],
          "remove"
        );
        if (!removeResult.ok) {
          throw removeResult.error || new Error("No pude expulsar al usuario.");
        }

        await sock.sendMessage(from, {
          text:
            `Enlace bloqueado: *${blockedLink.domain || blockedLink.raw}*\n` +
            `${getParticipantDisplayTag(null, sender)} expulsado automaticamente.`,
          mentions: mentionJid ? [mentionJid] : [],
          ...global.channelInfo,
        });
        return;
      } catch {}
    }

    await sock.sendMessage(from, {
      text:
        `Enlace bloqueado: *${blockedLink.domain || blockedLink.raw}*.\n` +
        (config.mode === "kick"
          ? "No pude expulsar al usuario, asi que solo borre el mensaje."
          : "El mensaje fue eliminado por anti-link."),
      ...global.channelInfo,
    });
  },
};
