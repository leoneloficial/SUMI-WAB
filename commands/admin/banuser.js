import path from "path";
import {
  ensureDatabaseDir,
  extractTargetUser,
  formatUserNumber,
  getPrefix,
  getQuoted,
  normalizeNumber,
  readJson,
  writeJson,
} from "./_shared.js";

const FILE = path.join(ensureDatabaseDir(), "blacklist-users.json");
const warnCooldown = new Map();

function loadStore() {
  const data = readJson(FILE, {});
  return data && typeof data === "object" && !Array.isArray(data)
    ? data
    : { users: {} };
}

function saveStore(data) {
  writeJson(FILE, data);
}

function getUsers(data) {
  if (!data.users || typeof data.users !== "object" || Array.isArray(data.users)) {
    data.users = {};
  }
  return data.users;
}

function isCommandText(text = "", settings) {
  const content = String(text || "").trim();
  const prefixes = Array.isArray(settings?.prefix)
    ? settings.prefix.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(settings?.prefix || ".").trim() || "."];
  return prefixes.some((prefix) => content.startsWith(prefix));
}

export default {
  name: "banuser",
  command: ["banuser", "unbanuser", "banlist"],
  category: "admin",
  description: "Bloquea o desbloquea usuarios del bot",

  async run({ sock, msg, from, args = [], esOwner, sender, settings, commandName }) {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const store = loadStore();
    const users = getUsers(store);
    const normalizedCommand = String(commandName || "banuser").toLowerCase();
    const prefix = getPrefix(settings);

    if (normalizedCommand === "banlist") {
      const lines = Object.entries(users).map(
        ([number, info]) =>
          `- ${formatUserNumber(number)} | ${String(info.reason || "Sin motivo")} | ${new Date(
            Number(info.bannedAt || Date.now())
          ).toLocaleString("es-PE")}`
      );

      return sock.sendMessage(
        from,
        {
          text:
            `*BLACKLIST USERS*\n\n` +
            `${lines.length ? lines.join("\n") : "Sin usuarios bloqueados."}`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    if (normalizedCommand === "unbanuser") {
      const target = extractTargetUser({ args, msg, sender });
      if (!target.number) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}unbanuser 519xxxxxxx* o responde al usuario.`,
            ...global.channelInfo,
          },
          getQuoted(msg)
        );
      }

      delete users[target.number];
      saveStore(store);

      return sock.sendMessage(
        from,
        {
          text: `Usuario desbloqueado: *${formatUserNumber(target.number)}*`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const target = extractTargetUser({ args, msg, sender });
    if (!target.number) {
      return sock.sendMessage(
        from,
        {
          text:
            `Usa: *${prefix}banuser 519xxxxxxx motivo*\n` +
            `o responde al usuario para bloquearlo.`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const reason = String(target.restArgs.join(" ") || "Uso indebido").trim().slice(0, 120);
    users[target.number] = {
      reason,
      bannedAt: Date.now(),
      bannedBy: normalizeNumber(sender),
    };
    saveStore(store);

    return sock.sendMessage(
      from,
      {
        text:
          `Usuario bloqueado: *${formatUserNumber(target.number)}*\n` +
          `Motivo: *${reason}*`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );
  },

  async onMessage({ sock, msg, from, sender, esOwner, settings }) {
    if (esOwner) return false;

    const number = normalizeNumber(sender);
    if (!number) return false;

    const store = loadStore();
    const users = getUsers(store);
    const entry = users[number];
    if (!entry) return false;

    const text =
      msg?.message?.conversation ||
      msg?.message?.extendedTextMessage?.text ||
      msg?.message?.imageMessage?.caption ||
      msg?.message?.videoMessage?.caption ||
      "";

    const now = Date.now();
    if (isCommandText(text, settings) && now - Number(warnCooldown.get(number) || 0) > 60_000) {
      warnCooldown.set(number, now);
      await sock.sendMessage(
        from,
        {
          text: `No puedes usar el bot.\nMotivo: ${entry.reason || "Sin motivo"}`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    return true;
  },
};
