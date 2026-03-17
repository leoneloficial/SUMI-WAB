import { buyItem, formatCoins, getPrefix } from "./_shared.js";

export default {
  name: "buy",
  command: ["buy", "comprar"],
  category: "economia",
  description: "Compra un item de la tienda",

  run: async ({ sock, msg, from, sender, args = [], settings }) => {
    const itemId = String(args[0] || "").trim().toLowerCase();
    const prefix = getPrefix(settings);

    if (!itemId) {
      return sock.sendMessage(
        from,
        {
          text: `Usa: *${prefix}buy id_del_item*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const result = buyItem(sender, itemId);
    if (!result.ok) {
      let text = "No pude completar la compra.";

      if (result.status === "missing_item") {
        text = `Ese item no existe. Revisa *${prefix}shop*.`;
      } else if (result.status === "insufficient") {
        text =
          `No te alcanza.\n` +
          `Te faltan *${formatCoins(result.missing || 0)}* para comprar *${result.item?.id || itemId}*.`;
      }

      return sock.sendMessage(
        from,
        {
          text,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    await sock.sendMessage(
      from,
      {
        text:
          `*COMPRA EXITOSA*\n\n` +
          `Item: *${result.item.id}*\n` +
          `Precio: *${formatCoins(result.item.price)}*\n` +
          `Saldo actual: *${formatCoins(result.user.coins || 0)}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
