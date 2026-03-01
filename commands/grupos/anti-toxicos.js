import fs from "fs";
import path from "path";

const DB_DIR = path.join(process.cwd(), "database");

// Lista de palabras (solo se edita desde el archivo)
const WORDS_FILE = path.join(DB_DIR, "badwords_words.json");

// Persistencia
const GROUPS_FILE = path.join(DB_DIR, "antitoxicos_groups.json");
const WARNS_FILE = path.join(DB_DIR, "antitoxicos_warns.json");

const MAX_WARNS = 3;

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ---------- helpers ----------
function safeJsonParse(raw, fallback) {
  try {
    const a = JSON.parse(raw);
    if (typeof a === "string") return JSON.parse(a);
    return a;
  } catch {
    return fallback;
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8");
    return safeJsonParse(raw, fallback);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadWords() {
  // crea archivo si no existe
  if (!fs.existsSync(WORDS_FILE)) writeJson(WORDS_FILE, []);
  const arr = readJson(WORDS_FILE, []);
  return Array.isArray(arr) ? arr : [];
}

function loadGroupsSet() {
  const arr = readJson(GROUPS_FILE, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

function saveGroupsSet(set) {
  writeJson(GROUPS_FILE, [...set]);
}

function loadWarns() {
  // { [groupId]: { [userJid]: number } }
  const obj = readJson(WARNS_FILE, {});
  return obj && typeof obj === "object" ? obj : {};
}

function saveWarns(obj) {
  writeJson(WARNS_FILE, obj);
}

function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")       // quita tildes
    .replace(/[^a-z0-9\s]/g, " ")          // quita signos
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    null
  );
}

function findBadWord(normalizedText, words) {
  const tokens = new Set(normalizedText.split(" ").filter(Boolean));

  // 1) token exacto
  for (const w of words) {
    const ww = normalizeText(w);
    if (!ww) continue;
    if (tokens.has(ww)) return w;
  }

  // 2) frase compuesta (si en la lista hay insultos con espacios)
  for (const w of words) {
    const ww = normalizeText(w);
    if (!ww) continue;
    if (ww.includes(" ") && normalizedText.includes(ww)) return w;
  }

  return null;
}

function onOff(v) {
  return v ? "ON ✅" : "OFF ❌";
}

// ---------- state ----------
let gruposActivos = loadGroupsSet();

export default {
  command: ["antitoxicos", "antitoxico", "antimalas", "antinsultos"],
  category: "grupo",
  description: "Anti-tóxicos: 3 advertencias y expulsión (solo admins)",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args }) => {
    const sub = (args[0] || "").toLowerCase();

    // Mostrar estado y ayuda
    if (!sub) {
      const st = gruposActivos.has(from);
      return sock.sendMessage(
        from,
        {
          text:
            `🛡️ *ANTI-TÓXICOS*\n` +
            `• Estado: *${onOff(st)}*\n\n` +
            `⚙️ Comandos:\n` +
            `• .antitoxicos on\n` +
            `• .antitoxicos off\n\n` +
            `📌 *Sistema:* 3 advertencias = expulsión`,
          ...global.channelInfo
        },
        { quoted: msg }
      );
    }

    if (sub === "on") {
      gruposActivos.add(from);
      saveGroupsSet(gruposActivos);
      return sock.sendMessage(
        from,
        { text: "✅ Anti-tóxicos activado para este grupo.", ...global.channelInfo },
        { quoted: msg }
      );
    }

    if (sub === "off") {
      gruposActivos.delete(from);
      saveGroupsSet(gruposActivos);
      return sock.sendMessage(
        from,
        { text: "✅ Anti-tóxicos desactivado para este grupo.", ...global.channelInfo },
        { quoted: msg }
      );
    }

    // No mostramos lista ni edición
    return sock.sendMessage(
      from,
      { text: "❌ Opción inválida. Usa: .antitoxicos on / .antitoxicos off", ...global.channelInfo },
      { quoted: msg }
    );
  },

  onMessage: async ({ sock, msg, from, esGrupo, esAdmin, esOwner }) => {
    if (!esGrupo) return;
    if (!gruposActivos.has(from)) return;

    // No castigar admins/owner
    if (esAdmin || esOwner) return;

    const sender = msg.key.participant;
    if (!sender) return;

    const textRaw = extractText(msg.message);
    if (!textRaw) return;

    const normalized = normalizeText(textRaw);
    if (!normalized) return;

    const words = loadWords();
    if (!words.length) return;

    const bad = findBadWord(normalized, words);
    if (!bad) return;

    // borrar mensaje (si el bot tiene permisos)
    try {
      await sock.sendMessage(from, { delete: msg.key, ...global.channelInfo });
    } catch {}

    // sumar warn (PERSISTENTE)
    const warns = loadWarns();
    if (!warns[from]) warns[from] = {};
    const current = Number(warns[from][sender] || 0) + 1;
    warns[from][sender] = current;
    saveWarns(warns);

    // acción
    if (current >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        await sock.sendMessage(from, {
          text:
            `🚫 *ANTI-TÓXICOS*\n` +
            `@${sender.split("@")[0]} llegó a *${current}/${MAX_WARNS}* advertencias.\n` +
            `✅ Fue expulsado del grupo.`,
          mentions: [sender],
          ...global.channelInfo
        });
      } catch {
        await sock.sendMessage(from, {
          text:
            `🚫 *ANTI-TÓXICOS*\n` +
            `@${sender.split("@")[0]} llegó a *${current}/${MAX_WARNS}* advertencias.\n` +
            `⚠️ No pude expulsar (¿bot sin admin?).`,
          mentions: [sender],
          ...global.channelInfo
        });
      }

      // reset si vuelve a entrar
      warns[from][sender] = 0;
      saveWarns(warns);
      return;
    }

    await sock.sendMessage(from, {
      text:
        `⚠️ *ANTI-TÓXICOS*\n` +
        `@${sender.split("@")[0]} cuidado con el lenguaje.\n` +
        `📌 Advertencia: *${current}/${MAX_WARNS}*`,
      mentions: [sender],
      ...global.channelInfo
    });
  }
};
