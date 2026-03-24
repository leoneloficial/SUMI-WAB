import fs from "fs";
import path from "path";

function resolveSafePath(input = "") {
  const requested = String(input || "").trim();
  if (!requested) return "";

  try {
    const cwd = fs.realpathSync(process.cwd());
    const resolved = path.resolve(cwd, requested);
    const normalized = fs.realpathSync.native
      ? fs.realpathSync.native(path.dirname(resolved))
      : fs.realpathSync(path.dirname(resolved));
    const candidate = path.join(normalized, path.basename(resolved));
    const relative = path.relative(cwd, candidate);

    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
    return candidate;
  } catch {
    return "";
  }
}

export default {
  name: "getfile",
  command: ["getfile"],
  category: "admin",
  description: "Envia un archivo local del bot",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const filePath = resolveSafePath(args.join(" "));

    if (!filePath) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .getfile <ruta relativa dentro del bot>",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return sock.sendMessage(
        from,
        {
          text: "No encontre ese archivo.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        document: fs.readFileSync(filePath),
        fileName: path.basename(filePath),
        mimetype: "application/octet-stream",
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
