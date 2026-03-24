function isEvalEnabled() {
  return String(process.env.ALLOW_OWNER_EVAL || "").trim().toLowerCase() === "true";
}

export default {
  name: "eval",
  command: ["eval"],
  category: "admin",
  description: "Evalua codigo JavaScript en tiempo real",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    if (!isEvalEnabled()) {
      return sock.sendMessage(
        from,
        {
          text: "El comando .eval esta deshabilitado en produccion. Activa ALLOW_OWNER_EVAL=true para usarlo.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const code = String(args.join(" ") || "").trim();

    if (!code) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .eval <codigo>",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    try {
      const output = await eval(`(async () => { ${code} })()`);
      const text =
        typeof output === "string"
          ? output
          : JSON.stringify(output, null, 2) || "Sin resultado";

      return sock.sendMessage(
        from,
        {
          text: text.slice(0, 3900) || "Sin resultado",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (error) {
      return sock.sendMessage(
        from,
        {
          text: `EVAL ERROR\n\n${String(error?.stack || error || "error desconocido").slice(0, 3900)}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }
  },
};
