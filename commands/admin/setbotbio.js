import fs from "fs";
import path from "path";
import { getQuoted } from "./_shared.js";

const SETTINGS_FILE = path.join(process.cwd(), "settings", "settings.json");

function getSubbotSlot(botId = "") {
  const match = String(botId || "")
    .trim()
    .toLowerCase()
    .match(/^subbot(\d{1,2})$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export default {
  name: "setbotbio",
  command: ["setbotbio", "botbio", "setbio"],
  category: "admin",
  description: "Cambia el estado o bio del bot actual",

  run: async ({ sock, msg, from, args = [], esOwner, settings, botId, botLabel }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        {
          text: "Solo el owner puede usar este comando.",
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const nextBio = String(args.join(" ") || "").trim().replace(/\s+/g, " ").slice(0, 139);
    if (!nextBio) {
      return sock.sendMessage(
        from,
        {
          text: "Usa: *.setbotbio Texto del estado*",
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    try {
      if (typeof sock.updateProfileStatus !== "function") {
        throw new Error("Este entorno de Baileys no soporta cambiar bio.");
      }

      await sock.updateProfileStatus(nextBio);

      settings.system = settings.system && typeof settings.system === "object" ? settings.system : {};
      if (String(botId || "").toLowerCase() === "main") {
        settings.system.mainBotBio = nextBio;
      } else {
        const slot = getSubbotSlot(botId);
        if (slot >= 1 && Array.isArray(settings.subbots) && settings.subbots[slot - 1]) {
          settings.subbots[slot - 1].bio = nextBio;
        }
      }
      saveSettings(settings);

      await sock.sendMessage(
        from,
        {
          text:
            `*${String(botLabel || "BOT").toUpperCase()} BIO ACTUALIZADA*\n\n` +
            `${nextBio}`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    } catch (error) {
      await sock.sendMessage(
        from,
        {
          text: `No pude cambiar la bio del bot.\n\n${error?.message || error}`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }
  },
};
