import { exec } from "child_process";

function isExecEnabled() {
  return String(process.env.ALLOW_OWNER_EXEC || "").trim().toLowerCase() === "true";
}

export default {
  name: "exec",
  command: ["exec"],
  category: "admin",
  description: "Ejecuta un comando del sistema",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    if (!isExecEnabled()) {
      return sock.sendMessage(
        from,
        {
          text: "El comando .exec esta deshabilitado en produccion. Activa ALLOW_OWNER_EXEC=true para usarlo.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const command = String(args.join(" ") || "").trim();

    if (!command) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .exec <comando>",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return await new Promise((resolve) => {
      exec(
        command,
        {
          cwd: process.cwd(),
          timeout: 20_000,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        },
        async (error, stdout, stderr) => {
          const chunks = [];
          if (stdout?.trim()) chunks.push(`STDOUT\n${stdout.trim()}`);
          if (stderr?.trim()) chunks.push(`STDERR\n${stderr.trim()}`);
          if (error && !chunks.length) {
            chunks.push(String(error?.stack || error || "error desconocido"));
          }

          await sock.sendMessage(
            from,
            {
              text: (chunks.join("\n\n") || "Comando ejecutado sin salida.").slice(0, 3900),
              ...global.channelInfo,
            },
            { quoted: msg }
          );

          resolve();
        }
      );
    });
  },
};
