import fs from "fs";
import path from "path";
import axios from "axios";

// ================== DB ==================
const DB_DIR = path.join(process.cwd(), "database");
const archivo = path.join(DB_DIR, "welcome.json");

let gruposWelcome = new Set();

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

if (fs.existsSync(archivo)) {
  try {
    const data = JSON.parse(fs.readFileSync(archivo, "utf-8"));
    gruposWelcome = new Set(Array.isArray(data) ? data : []);
  } catch {
    gruposWelcome = new Set();
  }
}

const guardar = () =>
  fs.writeFileSync(archivo, JSON.stringify([...gruposWelcome], null, 2));

// ================== HELPERS ==================
const getPfpBuffer = async (sock, jid) => {
  try {
    const url = await sock.profilePictureUrl(jid, "image"); // o "preview"
    if (!url) return null;

    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    return Buffer.from(res.data);
  } catch {
    return null;
  }
};

export default {
  name: "welcome",
  command: ["welcome"],
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
`⚙️ *WELCOME (Bienvenida)*

✅ *Activar:*  !welcome on
🚫 *Desactivar:* !welcome off`,
          ...global.channelInfo
        },
        quoted
      );
    }

    const opcion = args[0].toLowerCase();

    if (opcion === "on") {
      gruposWelcome.add(from);
      guardar();
      return await sock.sendMessage(
        from,
        { text: "👋 *Sistema de bienvenida activado.*", ...global.channelInfo },
        quoted
      );
    }

    if (opcion === "off") {
      gruposWelcome.delete(from);
      guardar();
      return await sock.sendMessage(
        from,
        { text: "🚫 *Sistema de bienvenida desactivado.*", ...global.channelInfo },
        quoted
      );
    }

    return await sock.sendMessage(
      from,
      { text: "❌ Opción inválida. Usa: *on* o *off*", ...global.channelInfo },
      quoted
    );
  },

  async onGroupUpdate({ sock, update }) {
    if (!update?.id) return;
    if (!gruposWelcome.has(update.id)) return;

    if (update.action !== "add") return;

    // nombre del grupo (si falla, no pasa nada)
    let groupName = "el grupo";
    try {
      const meta = await sock.groupMetadata(update.id);
      groupName = meta?.subject || groupName;
    } catch {}

    for (const user of update.participants || []) {
      const userTag = `@${user.split("@")[0]}`;

      const caption =
`✨ *BIENVENIDO/A* ✨

👤 Usuario: ${userTag}
🏠 Grupo: *${groupName}*

📌 *Por favor:*
• Lee las reglas
• Respeta a los demás
• Nada de spam 😎

🤖 _Disfruta tu estadía_`;

      const pfp = await getPfpBuffer(sock, user);

      if (pfp) {
        await sock.sendMessage(update.id, {
          image: pfp,
          caption,
          mentions: [user],
          ...global.channelInfo
        });
      } else {
        // si no hay foto de perfil
        await sock.sendMessage(update.id, {
          text: caption,
          mentions: [user],
          ...global.channelInfo
        });
      }
    }
  }
};
