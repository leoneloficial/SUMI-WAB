import fs from "fs";
import path from "path";
import {
  getParticipantMentionJid,
} from "../../lib/group-compat.js";

// ================== DB ==================
const DB_DIR = path.join(process.cwd(), "database");
const archivo = path.join(DB_DIR, "modoadmi.json");

let gruposAdmin = new Set();

// Crear carpeta database si no existe
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// Cargar datos existentes
if (fs.existsSync(archivo)) {
  try {
    const data = JSON.parse(fs.readFileSync(archivo, "utf-8"));
    gruposAdmin = new Set(Array.isArray(data) ? data : []);
  } catch {
    gruposAdmin = new Set();
  }
}

// Guardar cambios
const guardar = () =>
  fs.writeFileSync(archivo, JSON.stringify([...gruposAdmin], null, 2));

// Anti-spam del aviso (por usuario)
const warnCooldown = new Map();
const WARN_MS = 15_000;

export default {
  name: "modoadmi",
  command: ["modoadmi"],
  groupOnly: true,
  adminOnly: true,
  category: "grupo",

  async run({ sock, from, args, m, msg }) {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;

    if (!args[0]) {
      return await sock.sendMessage(
        from,
        {
          text:
`🛡️ *MODO ADMIN*

📌 *Uso:*
• .modoadmi on
• .modoadmi off

✅ *ON:* Solo admins/owner usan comandos
🚫 *OFF:* Todos pueden usar comandos`,
          ...global.channelInfo
        },
        quoted
      );
    }

    const opcion = args[0].toLowerCase();

    if (opcion === "on") {
      gruposAdmin.add(from);
      guardar();
      return await sock.sendMessage(
        from,
        {
          text:
`🔒 *Modo admin activado*

✅ Ahora *solo admins y owner* pueden usar comandos en este grupo.`,
          ...global.channelInfo
        },
        quoted
      );
    }

    if (opcion === "off") {
      gruposAdmin.delete(from);
      guardar();
      return await sock.sendMessage(
        from,
        {
          text:
`🔓 *Modo admin desactivado*

✅ Ahora *todos* pueden usar comandos en este grupo.`,
          ...global.channelInfo
        },
        quoted
      );
    }

    return await sock.sendMessage(
      from,
      { text: "❌ Opción inválida. Usa: *on* o *off*", ...global.channelInfo },
      quoted
    );
  },

  // Devuelve true para bloquear ejecución de comandos (así funciona tu index.js)
  async onMessage({ sock, from, esGrupo, esAdmin, esOwner, msg, settings, comandos }) {
    if (!esGrupo) return;
    if (!gruposAdmin.has(from)) return;

    // Permitir solo admins y owner
    if (esAdmin || esOwner) return;

    const texto =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    const txt = texto.trim();
    if (!txt) return;

    // ===== MODO SIN PREFIJO =====
    const noPrefix =
      settings?.noPrefix === true ||
      !settings?.prefix ||
      (Array.isArray(settings.prefix) && settings.prefix.length === 0);

    if (noPrefix) {
      const posible = txt.split(/\s+/)[0]?.toLowerCase();
      if (posible && comandos?.has(posible)) {
        // aviso con cooldown
        const sender = msg.sender || msg.key?.participant || msg.key?.remoteJid || from;
        const now = Date.now();
        if (!warnCooldown.has(sender) || now > warnCooldown.get(sender)) {
          warnCooldown.set(sender, now + WARN_MS);
          const mentionJid = getParticipantMentionJid({}, null, sender);
          await sock.sendMessage(from, {
            text: "🛡️ *Modo admin activo:* solo admins/owner pueden usar comandos.",
            mentions: mentionJid ? [mentionJid] : [],
            ...global.channelInfo
          });
        }
        return true;
      }
      return;
    }

    // ===== CON PREFIJO (string o array) =====
    const prefijos = Array.isArray(settings.prefix) ? settings.prefix : [settings.prefix];
    const prefijoUsado = prefijos.filter(Boolean).find((p) => txt.startsWith(p));

    // Si no empieza con prefijo, no es comando → no bloquear
    if (!prefijoUsado) return;

    // Extraer el comando real después del prefijo
    const body = txt.slice(prefijoUsado.length).trim();
    const posibleCmd = body.split(/\s+/)[0]?.toLowerCase();

    // ✅ SOLO bloquear si el comando existe
    if (posibleCmd && comandos?.has(posibleCmd)) {
      const sender = msg.sender || msg.key?.participant || msg.key?.remoteJid || from;
      const now = Date.now();
      if (!warnCooldown.has(sender) || now > warnCooldown.get(sender)) {
        warnCooldown.set(sender, now + WARN_MS);
        const mentionJid = getParticipantMentionJid({}, null, sender);
        await sock.sendMessage(from, {
          text: "🛡️ *Modo admin activo:* solo admins/owner pueden usar comandos.",
          mentions: mentionJid ? [mentionJid] : [],
          ...global.channelInfo
        });
      }
      return true;
    }
  }
};
