import {
  buildSubbotMediaMessage,
  formatDuration,
  buildSubbotCard,
  formatDateTime,
  getCurrentChatStatus,
  getPrefix,
  getSubbotQuoted,
  hasSubbotRuntime,
  normalizeNumber,
} from "./_shared.js";

function hasOwnerViewAccess(action = "", commandName = "") {
  const normalizedAction = String(action || "").trim().toLowerCase();
  const normalizedCommand = String(commandName || "").trim().toLowerCase();

  return (
    normalizedAction === "owner" ||
    normalizedAction === "admin" ||
    normalizedAction === "panel" ||
    normalizedCommand === "subbotsowner" ||
    normalizedCommand === "ownersubbots" ||
    normalizedCommand === "subbotpanel"
  );
}

function isSlotOccupied(bot = {}) {
  return Boolean(
    bot.connected ||
      bot.registered ||
      bot.pairingPending ||
      bot.connecting ||
      normalizeNumber(bot.requesterNumber || "") ||
      normalizeNumber(bot.configuredNumber || "")
  );
}

function buildOwnerSubbotSummary(bot = {}) {
  const number = normalizeNumber(bot.configuredNumber || "");
  const requester = normalizeNumber(bot.requesterNumber || "");
  const state =
    bot.connected
      ? "CONECTADO"
      : bot.connecting
        ? "CONECTANDO"
        : bot.pairingPending
          ? "ESPERANDO CODIGO"
          : bot.registered
            ? "VINCULADO SIN SESION"
            : "RESERVADO";

  const connectedSince = bot.connectedAt
    ? formatDateTime(bot.connectedAt)
    : "Sin conexion activa";
  const uptime = bot.connected
    ? formatDuration(bot.connectedForMs || 0)
    : "0s";
  const lastSeen = bot.lastIncomingMessageAt
    ? formatDateTime(bot.lastIncomingMessageAt)
    : "Sin mensajes recientes";

  return (
    `Slot ${bot.slot} | ${bot.label || `SUBBOT${bot.slot}`}\n` +
    `Bot: ${bot.displayName}\n` +
    `Estado: ${state}\n` +
    `Numero: ${number || "No definido"}\n` +
    `Solicitante: ${requester || "No definido"}\n` +
    `Desde: ${connectedSince}\n` +
    `Tiempo: ${uptime}\n` +
    `Ultimo msg: ${lastSeen}`
  );
}

function buildOwnerInteractiveSections(bots = [], prefix = ".") {
  const managed = bots
    .filter((bot) => isSlotOccupied(bot))
    .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0))
    .slice(0, 24);

  const detailsRows = managed.map((bot) => ({
    header: `${bot.slot}`,
    title: `${bot.label || `SUBBOT${bot.slot}`} | ${bot.displayName}`.slice(0, 72),
    description: `Estado: ${bot.connected ? "conectado" : bot.connecting ? "conectando" : bot.pairingPending ? "esperando codigo" : bot.registered ? "vinculado" : "reservado"}`.slice(0, 72),
    id: `${prefix}subbot info ${bot.slot}`,
  }));

  const reconnectRows = managed.map((bot) => ({
    header: `${bot.slot}`,
    title: `Reconectar ${bot.label || `SUBBOT${bot.slot}`}`.slice(0, 72),
    description: "Reconexion limpia sin borrar sesion".slice(0, 72),
    id: `${prefix}subbot reconectar ${bot.slot}`,
  }));

  const releaseRows = managed.map((bot) => ({
    header: `${bot.slot}`,
    title: `Liberar ${bot.label || `SUBBOT${bot.slot}`}`.slice(0, 72),
    description: "Quitar slot y borrar sesion del subbot".slice(0, 72),
    id: `${prefix}subbot liberar ${bot.slot}`,
  }));

  const sections = [];

  if (detailsRows.length) {
    sections.push({
      title: "Ver detalle de slot",
      rows: detailsRows,
    });
  }

  if (reconnectRows.length) {
    sections.push({
      title: "Reconectar subbot",
      rows: reconnectRows,
    });
  }

  if (releaseRows.length) {
    sections.push({
      title: "Quitar/Liberar subbot",
      rows: releaseRows,
    });
  }

  return sections;
}

export default {
  name: "subbots",
  command: [
    "bots",
    "codigosubbots",
    "estadosubbots",
    "subbotsactivos",
    "subbotsowner",
    "ownersubbots",
    "subbotpanel",
  ],
  category: "subbots",
  description: "Muestra el panel de subbots",

  run: async ({
    sock,
    msg,
    from,
    args = [],
    settings,
    isGroup,
    botId,
    botLabel,
    esOwner,
    commandName,
  }) => {
    const quoted = getSubbotQuoted(msg);
    const prefix = getPrefix(settings);
    const runtime = global.botRuntime;
    const chatStatus = getCurrentChatStatus({ isGroup, botId, botLabel });
    const action = String(args?.[0] || "").trim().toLowerCase();
    const ownerView = hasOwnerViewAccess(action, commandName);

    if (!hasSubbotRuntime(runtime)) {
      return sock.sendMessage(
        from,
        {
          text: "No pude acceder al control interno del subbot.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    const subbotAccess = runtime.getSubbotRequestState();
    const bots = runtime
      .listBots()
      .slice()
      .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0));
    const publicLabel = subbotAccess.publicRequests ? "ENCENDIDO" : "APAGADO";
    const activeCount = bots.filter((bot) => bot.connected).length;
    const linkedCount = bots.filter((bot) => bot.registered).length;
    const enabledCount = bots.filter((bot) => bot.enabled).length;
    const waitingCount = bots.filter((bot) => bot.pairingPending || bot.connecting).length;
    const activeBots = bots.filter((bot) => bot.connected);
    const lines = bots.length
      ? bots.map((bot) => buildSubbotCard(bot, { compact: true }))
      : ["No hay slots de subbot disponibles."];
    const activeBotLines = activeBots.length
      ? activeBots.map(
          (bot) =>
            `- ${bot.label || `SUBBOT${bot.slot}`} | ${bot.displayName} | ${formatDuration(bot.connectedForMs || 0)}`
        )
      : ["- Ninguno activo ahora"];

    if (ownerView) {
      if (!esOwner) {
        return sock.sendMessage(
          from,
          {
            text: "Solo el owner puede abrir el panel privado de subbots.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const ownerBots = bots.filter((bot) => isSlotOccupied(bot));
      const ownerLines = ownerBots.length
        ? ownerBots
            .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0))
            .map((bot) => buildOwnerSubbotSummary(bot))
        : ["No hay subbots ocupados ahora mismo."];
      const sections = buildOwnerInteractiveSections(ownerBots, prefix);

      try {
        if (sections.length) {
          await sock.sendMessage(
            from,
            {
              text:
                `Panel owner de subbots.\n` +
                `Conectados: *${activeCount}* | Vinculados: *${linkedCount}* | En espera: *${waitingCount}*\n` +
                `Vista: ${chatStatus}`,
              title: "SUBBOTS OWNER",
              subtitle: "Gestion privada",
              footer: "FSOCIETY BOT",
              interactiveButtons: [
                {
                  name: "single_select",
                  buttonParamsJson: JSON.stringify({
                    title: "Acciones owner",
                    sections,
                  }),
                },
              ],
              ...global.channelInfo,
            },
            quoted
          );
        }
      } catch (error) {
        console.error("No pude enviar menu owner de subbots:", error?.message || error);
      }

      return sock.sendMessage(
        from,
        {
          text:
            `*PANEL OWNER SUBBOTS*\n\n` +
            `General\n` +
            `Modo publico: *${publicLabel}*\n` +
            `Capacidad: *${subbotAccess.maxSlots}*\n` +
            `Libres: *${subbotAccess.availableSlots}*\n` +
            `Activos: *${activeCount}*\n` +
            `En espera: *${waitingCount}*\n` +
            `Vinculados: *${linkedCount}*\n` +
            `Hora: ${formatDateTime(Date.now())}\n\n` +
            `${ownerLines.join("\n\n")}\n\n` +
            `Atajos owner\n` +
            `- ${prefix}subbot reconectar 3\n` +
            `- ${prefix}subbot liberar 3\n` +
            `- ${prefix}subbot info 3`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    return sock.sendMessage(
      from,
      buildSubbotMediaMessage(
        "subbotsactivos.png",
        `*PANEL SUBBOTS*\n\n` +
          `General\n` +
          `Modo publico: *${publicLabel}*\n` +
          `Capacidad: *${subbotAccess.maxSlots}*\n` +
          `Libres: *${subbotAccess.availableSlots}*\n` +
          `Activos: *${activeCount}*\n` +
          `Espera: *${waitingCount}*\n` +
          `Vinculados: *${linkedCount}*\n` +
          `Slots encendidos: *${enabledCount}*\n` +
          `Vista: ${chatStatus}\n` +
          `Hora: ${formatDateTime(Date.now())}\n\n` +
          `Bots activos ahora\n` +
          `${activeBotLines.join("\n")}\n\n` +
          `Slots\n\n` +
          `${lines.join("\n\n")}\n\n` +
          `Atajos\n` +
          `- ${prefix}subbot 519xxxxxxxxx\n` +
          `- ${prefix}subbot 3 519xxxxxxxxx\n` +
          `- ${prefix}subbots owner\n` +
          `- ${prefix}subbot info 3\n` +
          `- ${prefix}subbot liberar 3\n` +
          `- ${prefix}subbot reset 3\n` +
          `- ${prefix}subbot slots 20\n` +
          `- ${prefix}subbots\n` +
          `- ${prefix}subboton\n` +
          `- ${prefix}subbotoff`
      ),
      quoted
    );
  },
};
