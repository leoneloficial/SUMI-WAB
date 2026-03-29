import path from "path";
import { createScheduledJsonStore } from "../../lib/json-store.js";
import {
  findGroupParticipant,
  runGroupParticipantAction,
} from "../../lib/group-compat.js";

const FILE = path.join(process.cwd(), "database", "antiarab.json");
const DEFAULT_PREFIXES = ["212", "213", "216", "218", "20", "964", "966", "971", "973", "974", "968", "967", "962", "963", "965", "961", "970"];
const store = createScheduledJsonStore(FILE, () => ({
  groups: {},
}));

function ensureGroup(groupId) {
  const key = String(groupId || "").trim();
  if (!store.state.groups[key]) {
    store.state.groups[key] = {
      enabled: false,
      prefixes: [...DEFAULT_PREFIXES],
    };
  }
  return store.state.groups[key];
}

function normalizeParticipantNumber(value = "") {
  return String(value || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");
}

export default {
  name: "antiarab",
  command: ["antiarab"],
  category: "grupo",
  description: "Filtra numeros de ciertos prefijos al entrar al grupo",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const action = String(args[0] || "status").trim().toLowerCase();
    const config = ensureGroup(from);

    if (action === "on" || action === "off") {
      config.enabled = action === "on";
      store.scheduleSave();
      return sock.sendMessage(from, { text: `Antiarab: *${config.enabled ? "ENCENDIDO" : "APAGADO"}*`, ...global.channelInfo }, { quoted: msg });
    }

    return sock.sendMessage(
      from,
      {
        text:
          `*ANTIARAB*\n\n` +
          `Estado: *${config.enabled ? "ENCENDIDO" : "APAGADO"}*\n` +
          `Prefijos: ${config.prefixes.join(", ")}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },

  onGroupUpdate: async ({ sock, update }) => {
    if (!update?.id || update.action !== "add") return;
    const config = ensureGroup(update.id);
    if (!config.enabled) return;
    let metadata = null;

    try {
      metadata = await sock.groupMetadata(update.id);
    } catch {}

    for (const participant of update.participants || []) {
      const number = normalizeParticipantNumber(participant);
      if (!config.prefixes.some((prefix) => number.startsWith(prefix))) continue;

      try {
        await runGroupParticipantAction(
          sock,
          update.id,
          metadata || {},
          findGroupParticipant(metadata || {}, [participant]),
          [participant],
          "remove"
        );
      } catch {}
    }
  },
};
