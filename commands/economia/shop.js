import { formatCoins, getShopItems } from "./_shared.js";

export default {
  name: "shop",
  command: ["shop", "tienda"],
  category: "economia",
  description: "Muestra la tienda de economia",

  run: async ({ sock, msg, from }) => {
    const lines = getShopItems().map(
      (item) =>
        `*${item.id}* - ${formatCoins(item.price)}\n${item.name}\n${item.description}`
    );

    await sock.sendMessage(
      from,
      {
        text:
          `*TIENDA ECONOMIA*\n\n` +
          `${lines.join("\n\n")}\n\n` +
          `Compra con: *.buy id_del_item*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
