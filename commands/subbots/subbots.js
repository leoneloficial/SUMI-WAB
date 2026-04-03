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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumbersList(rawArgs = []) {
  const text = Array.isArray(rawArgs) ? rawArgs.join(" ") : String(rawArgs || "");
  const tokens = text
    .replace(/[,\n\r\t]/g, " ")
    .split(" ")
    .map((t) => normalizeNumber(t))
    .filter((t) => t.length >= 8);

  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
  }
  return unique.slice(0, 25);
}

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

  const slotRows = managed.map((bot) => {
    const assignedNumber = normalizeNumber(bot.configuredNumber || bot.requesterNumber || "");
    const state = bot.connected
      ? "conectado"
      : bot.connecting
        ? "conectando"
        : bot.pairingPending
          ? "esperando codigo"
          : bot.registered
            ? "vinculado"
            : "reservado";

    return {
      header: `${bot.slot}`,
      title: `${bot.label || `SUBBOT${bot.slot}`} | ${bot.displayName}`.slice(0, 72),
      description: `Nro: ${assignedNumber || "sin numero"} | ${state}`.slice(0, 72),
      id: `${prefix}subbot menu ${bot.slot}`,
    };
  });

  const globalRows = [
    {
      header: "GLOBAL",
      title: "Apagar solicitudes",
      description: "Nadie podra pedir subbot hasta activar".slice(0, 72),
      id: `${prefix}subbotoff`,
    },
    {
      header: "GLOBAL",
      title: "Encender solicitudes",
      description: "Permitir solicitudes publicas de subbot".slice(0, 72),
      id: `${prefix}subboton`,
    },
    {
      header: "BATCH",
      title: "Reconectar todos",
      description: "Fuerza reconexion de subbots habilitados".slice(0, 72),
      id: `${prefix}subbots reconectar`,
    },
    {
      header: "BATCH",
      title: "Vincular en lote",
      description: "Genera codigos para varios numeros".slice(0, 72),
      id: `${prefix}subbots vincular`,
    },
  ];

  const sections = [];

  if (slotRows.length) {
    sections.push({
      title: "Selecciona numero/slot",
      rows: slotRows,
    });
  }

  sections.push({
    title: "Control global owner",
    rows: globalRows,
  });

  return sections;
}

export default {
  name: "subbots",
  command: [
    "subbots",
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

    // Acciones en lote (solo owner, recomendado desde MAIN).
    if (["vincular", "link", "pair", "lote"].includes(action)) {
      if (!esOwner) {
        return sock.sendMessage(
          from,
          { text: "Solo el owner puede vincular subbots en lote.", ...global.channelInfo },
          quoted
        );
      }
      if (String(botId || "").toLowerCase() !== "main") {
        return sock.sendMessage(
          from,
          {
            text:
              "Este comando debe ejecutarse desde el *bot principal (MAIN)* para evitar choques de control.\n" +
              `Vista: ${chatStatus}`,
            ...global.channelInfo,
          },
          quoted
        );
      }

      const numbers = parseNumbersList(args.slice(1));
      if (!numbers.length) {
        return sock.sendMessage(
          from,
          {
            text:
              `Uso:\n` +
              `*${prefix}subbots vincular 51911111111 51922222222*\n\n` +
              `Tip: puedes pegar varios numeros separados por espacios o comas.`,
            ...global.channelInfo,
          },
          quoted
        );
      }

      await sock.sendMessage(
        from,
        {
          text:
            `Generando codigos para *${numbers.length}* subbots...\n` +
            `Esto reserva slots automaticamente si hay capacidad.`,
          ...global.channelInfo,
        },
        quoted
      );

      const results = [];
      for (const number of numbers) {
        try {
          const res = await runtime.requestBotPairingCode("subbot", {
            number,
            requesterNumber: number,
            requesterJid: String(msg?.sender || msg?.key?.participant || ""),
            bypassPublicRequests: true,
            useCache: true,
          });

          results.push({ number, res });
          // Evita rate limit de WhatsApp / proveedor
          await sleep(650);
          if (res?.status === "main_not_ready") break;
        } catch (error) {
          results.push({ number, res: { ok: false, message: error?.message || String(error) } });
          await sleep(350);
        }
      }

      const ok = results.filter((r) => r.res?.ok);
      const bad = results.filter((r) => !r.res?.ok);

      const okLines = ok.length
        ? ok
            .map((r) => {
              const slotLabel = r.res?.slot ? `Slot ${r.res.slot}` : "Slot";
              return (
                `✅ ${slotLabel} | ${r.res?.displayName || "Subbot"}\n` +
                `Nro: ${r.res?.number || r.number}\n` +
                `Codigo: ${r.res?.code || "N/A"}\n` +
                `Expira aprox: ${formatDuration(r.res?.expiresInMs || 0)}`
              );
            })
            .join("\n\n")
        : "Ningun codigo generado.";

      const badLines = bad.length
        ? "\n\nFallos\n" +
          bad
            .map((r) => `- ${r.number}: ${r.res?.message || "Fallo desconocido"}`.slice(0, 200))
            .join("\n")
        : "";

      return sock.sendMessage(
        from,
        {
          text:
            `*SUBBOTS | VINCULACION EN LOTE*\n\n` +
            `${okLines}` +
            `${badLines}\n\n` +
            `WhatsApp > Dispositivos vinculados > Vincular con numero de telefono.`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (["reconectar", "reconnect", "rc", "reconectartodos"].includes(action)) {
      if (!esOwner) {
        return sock.sendMessage(
          from,
          { text: "Solo el owner puede reconectar subbots en lote.", ...global.channelInfo },
          quoted
        );
      }

      const bots = runtime
        .listBots()
        .slice()
        .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0));
      const targets = bots.filter((bot) => bot.enabled && (bot.registered || bot.connected));

      if (!targets.length) {
        return sock.sendMessage(
          from,
          { text: "No hay subbots habilitados para reconectar.", ...global.channelInfo },
          quoted
        );
      }

      await sock.sendMessage(
        from,
        {
          text: `Reconectando *${targets.length}* subbots...`,
          ...global.channelInfo,
        },
        quoted
      );

      let okCount = 0;
      const errors = [];
      for (const bot of targets) {
        try {
          const res = await runtime.reconnectSubbot(`subbot${bot.slot}`, { reason: "owner_batch" });
          if (res?.ok) okCount += 1;
          if (!res?.ok) errors.push(`Slot ${bot.slot}: ${res?.message || "Fallo"}`);
        } catch (error) {
          errors.push(`Slot ${bot.slot}: ${error?.message || String(error)}`);
        }
        await sleep(450);
      }

      return sock.sendMessage(
        from,
        {
          text:
            `*SUBBOTS | RECONEXION EN LOTE*\n\n` +
            `Reconectados: *${okCount}/${targets.length}*\n` +
            (errors.length ? `Errores:\n${errors.slice(0, 12).join("\n")}` : "Sin errores reportados."),
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
                `Vista: ${chatStatus}\n` +
                `Toca un numero/slot para abrir su menu privado.`,
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
            `- ${prefix}subbot menu 3\n` +
            `- ${prefix}subbot reconectar 3\n` +
            `- ${prefix}subbot liberar 3\n` +
            `- ${prefix}subbot info 3\n` +
            `- ${prefix}subbotoff / ${prefix}subboton`,
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
          `- ${prefix}subbot menu 3\n` +
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
