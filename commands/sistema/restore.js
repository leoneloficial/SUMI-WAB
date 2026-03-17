import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();
const BACKUPS_DIR = path.join(ROOT_DIR, "backups");

function getQuoted(msg) {
  return msg?.key ? { quoted: msg } : undefined;
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

function findLatestBackup() {
  if (!fs.existsSync(BACKUPS_DIR)) return "";
  const entries = fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return entries[0] || "";
}

export default {
  name: "restore",
  command: ["restore"],
  category: "sistema",
  description: "Restaura un backup del bot",

  run: async ({ sock, msg, from, args = [], esOwner }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        { text: "Solo el owner puede usar este comando.", ...global.channelInfo },
        getQuoted(msg)
      );
    }

    const runtime = global.botRuntime;
    const targetName = String(args[0] || "").trim() || "latest";
    const backupName = targetName === "latest" ? findLatestBackup() : targetName;

    if (!backupName) {
      return sock.sendMessage(
        from,
        {
          text: "No encontre un backup para restaurar.",
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const backupPath = path.join(BACKUPS_DIR, backupName);
    if (!fs.existsSync(backupPath)) {
      return sock.sendMessage(
        from,
        {
          text: `No existe el backup *${backupName}*.`,
          ...global.channelInfo,
        },
        getQuoted(msg)
      );
    }

    const restored = [];
    if (copyIfExists(path.join(backupPath, "settings"), path.join(ROOT_DIR, "settings"))) restored.push("settings");
    if (copyIfExists(path.join(backupPath, "database"), path.join(ROOT_DIR, "database"))) restored.push("database");
    if (copyIfExists(path.join(backupPath, "videos"), path.join(ROOT_DIR, "videos"))) restored.push("videos");

    for (const entry of fs.readdirSync(backupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("dvyer-session")) continue;
      if (copyIfExists(path.join(backupPath, entry.name), path.join(ROOT_DIR, entry.name))) {
        restored.push(entry.name);
      }
    }

    await sock.sendMessage(
      from,
      {
        text:
          `*RESTORE COMPLETADO*\n\n` +
          `Backup: *${backupName}*\n` +
          `Restaurado: ${restored.join(", ") || "Nada"}\n\n` +
          `Voy a reiniciar el bot para aplicar los cambios.`,
        ...global.channelInfo,
      },
      getQuoted(msg)
    );

    runtime?.restartProcess?.(2000);
  },
};
