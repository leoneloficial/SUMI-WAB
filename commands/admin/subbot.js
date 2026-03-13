function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function normalizeNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeTimestamp(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getSenderNumber(sender) {
  return normalizeNumber(String(sender || "").split("@")[0].split(":")[0]);
}

function formatDateTime(value) {
  if (!value) return "Sin registro";

  try {
    return new Date(value).toLocaleString("es-PE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "Sin registro";
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getCurrentChatStatus({ isGroup, botId, botLabel }) {
  if (!isGroup) {
    return "Panel abierto por privado.";
  }

  if (String(botId || "").toLowerCase() === "main") {
    return "YA BOT principal activo aqui.";
  }

  return `${String(botLabel || "SUBBOT").toUpperCase()} activo aqui.`;
}

function getSubbotStateLabel(bot) {
  if (bot.connected) return "ACTIVO AHORA";
  if (bot.connecting) return "CONECTANDO";
  if (bot.registered) return "VINCULADO";
  if (bot.pairingPending) return "ESPERANDO CODIGO";
  if (!bot.enabled) return "LIBRE";
  return "RESERVADO";
}

function buildSubbotCard(bot) {
  const requesterNumber = bot.requesterNumber || "Sin solicitante";
  const linkedNumber = bot.configuredNumber || "No configurado";
  const requestedAt = normalizeTimestamp(bot.requestedAt);
  const releasedAt = normalizeTimestamp(bot.releasedAt);
  const connectedFor = bot.connectedForMs
    ? formatDuration(bot.connectedForMs)
    : "No conectado";
  const requestedFor = requestedAt
    ? formatDateTime(requestedAt)
    : "Sin solicitud";
  const releasedText = releasedAt
    ? formatDateTime(releasedAt)
    : "Sin liberar aun";
  const horaActiva = bot.connectedAt ? formatDateTime(bot.connectedAt) : "No conectado";
  const ultimaSalida = bot.lastDisconnectAt
    ? formatDateTime(bot.lastDisconnectAt)
    : "Sin desconexion reciente";

  let extra = "";

  if (bot.cachedPairingCode) {
    extra =
      `\nCodigo en cache: ${bot.cachedPairingCode}` +
      `\nExpira en: ${formatDuration(bot.cachedPairingExpiresInMs)}`;
  }

  return (
    `*Slot ${bot.slot} - ${bot.label}*\n` +
    `Estado: ${getSubbotStateLabel(bot)}\n` +
    `Bot: ${bot.displayName}\n` +
    `Solicitante: ${requesterNumber}\n` +
    `Numero vinculado: ${linkedNumber}\n` +
    `Solicitado: ${requestedFor}\n` +
    `Conectado desde: ${horaActiva}\n` +
    `Tiempo conectado: ${connectedFor}\n` +
    `Ultima salida: ${ultimaSalida}\n` +
    `Liberado: ${releasedText}\n` +
    `Sesion: ${bot.authFolder}${extra}`
  );
}

function parseSlotToken(value, maxSlots) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;

  const directNumber = Number.parseInt(raw, 10);
  if (String(directNumber) === raw && directNumber >= 1 && directNumber <= maxSlots) {
    return directNumber;
  }

  const match = raw.match(/^(?:subbot|slot)(\d{1,2})$/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  if (parsed >= 1 && parsed <= maxSlots) {
    return parsed;
  }

  return null;
}

function parseSubbotArgs(args = [], maxSlots = 15) {
  const tokens = (Array.isArray(args) ? args : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!tokens.length) {
    return { action: "pair", slot: null, number: "" };
  }

  const first = tokens[0].toLowerCase();
  const slot = parseSlotToken(tokens[0], maxSlots);
  const onActions = ["on", "activar", "encender", "publico", "public"];
  const offActions = ["off", "desactivar", "apagar", "cerrar", "close"];
  const listActions = ["list", "lista", "status", "estado", "panel", "codigo", "codigos"];

  if (onActions.includes(first)) {
    return { action: "on", slot: null, number: "" };
  }

  if (offActions.includes(first)) {
    return { action: "off", slot: null, number: "" };
  }

  if (listActions.includes(first)) {
    return { action: "list", slot: null, number: "" };
  }

  if (slot) {
    if (tokens.length === 1) {
      return { action: "pair", slot, number: "" };
    }

    if (tokens.length === 2) {
      const number = normalizeNumber(tokens[1]);
      if (number) {
        return { action: "pair", slot, number };
      }
    }

    return { action: "invalid", slot: null, number: "" };
  }

  if (tokens.length === 1) {
    const number = normalizeNumber(tokens[0]);
    if (number) {
      return { action: "pair", slot: null, number };
    }
  }

  return { action: "invalid", slot: null, number: "" };
}

function commandDefaultsToList(commandName) {
  const normalized = String(commandName || "").toLowerCase();
  return ["subbots", "codigosubbots", "estadosubbots", "subbotsactivos"].includes(normalized);
}

export default {
  name: "subbot",
  command: [
    "subbot",
    "subbotcode",
    "codesubbot",
    "subbots",
    "codigosubbots",
    "estadosubbots",
    "subbotsactivos",
  ],
  category: "subbots",
  description: "Panel para pedir, activar y revisar subbots",

  run: async ({
    sock,
    msg,
    from,
    sender,
    args = [],
    settings,
    esOwner,
    commandName,
    isGroup,
    botId,
    botLabel,
  }) => {
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const prefix = getPrefix(settings);
    const runtime = global.botRuntime;
    const chatStatus = getCurrentChatStatus({ isGroup, botId, botLabel });
    const senderNumber = getSenderNumber(sender);

    if (
      !runtime?.requestBotPairingCode ||
      !runtime?.listBots ||
      !runtime?.getSubbotRequestState ||
      !runtime?.setSubbotPublicRequests
    ) {
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
    const parsed = parseSubbotArgs(
      !args.length && commandDefaultsToList(commandName) ? ["list"] : args,
      Number(subbotAccess?.maxSlots || 15)
    );

    if (parsed.action === "on") {
      if (!esOwner) {
        return sock.sendMessage(
          from,
          {
            text: "Solo el owner puede activar el subbot para todos.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const nextState = runtime.setSubbotPublicRequests(true);

      return sock.sendMessage(
        from,
        {
          text:
            `*SUBBOTS ACTIVADOS*\n\n` +
            `Acceso publico: *ENCENDIDO*\n` +
            `Capacidad total: *${nextState.maxSlots} slots*\n` +
            `Slots libres: *${nextState.availableSlots}*\n` +
            `Ahora todos pueden usar *${prefix}subbot* para pedir codigo.\n` +
            `En este chat: ${chatStatus}`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (parsed.action === "off") {
      if (!esOwner) {
        return sock.sendMessage(
          from,
          {
            text: "Solo el owner puede apagar el acceso a los subbots.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const nextState = runtime.setSubbotPublicRequests(false);

      return sock.sendMessage(
        from,
        {
          text:
            `*SUBBOTS APAGADOS*\n\n` +
            `Acceso publico: *APAGADO*\n` +
            `Slots configurables: *${nextState.maxSlots}*\n` +
            `Slots libres: *${nextState.availableSlots}*\n` +
            `Nadie podra pedir codigo hasta que vuelvas a activarlo.\n` +
            `En este chat: ${chatStatus}`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (parsed.action === "list") {
      const bots = runtime
        .listBots()
        .slice()
        .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0));
      const publicLabel = subbotAccess.publicRequests ? "ENCENDIDO" : "APAGADO";
      const activeCount = bots.filter((bot) => bot.connected).length;
      const linkedCount = bots.filter((bot) => bot.registered).length;
      const enabledCount = bots.filter((bot) => bot.enabled).length;
      const lines = bots.length
        ? bots.map((bot) => buildSubbotCard(bot))
        : ["No hay slots de subbot disponibles."];

      return sock.sendMessage(
        from,
        {
          text:
            `*PANEL SUBBOTS*\n\n` +
            `Modo publico: *${publicLabel}*\n` +
            `Capacidad: *${subbotAccess.maxSlots} slots*\n` +
            `Slots libres: *${subbotAccess.availableSlots}*\n` +
            `Slots activados: *${enabledCount}*\n` +
            `Subbots vinculados: *${linkedCount}*\n` +
            `Activos ahora: *${activeCount}*\n` +
            `Hora actual: ${formatDateTime(Date.now())}\n` +
            `En este chat: ${chatStatus}\n\n` +
            `${lines.join("\n\n")}\n\n` +
            `Comandos:\n` +
            `${prefix}subbot\n` +
            `${prefix}subbot 3\n` +
            `${prefix}subbot 519xxxxxxxxx\n` +
            `${prefix}subbot 3 519xxxxxxxxx\n` +
            `${prefix}codigosubbots\n` +
            `${prefix}subbot on\n` +
            `${prefix}subbot off`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (parsed.action === "invalid") {
      return sock.sendMessage(
        from,
        {
          text:
            `Uso correcto:\n` +
            `*${prefix}subbot*\n` +
            `*${prefix}subbot 3*\n` +
            `*${prefix}subbot 519xxxxxxxxx*\n` +
            `*${prefix}subbot 3 519xxxxxxxxx*\n` +
            `*${prefix}codigosubbots*\n` +
            `*${prefix}subbot on*\n` +
            `*${prefix}subbot off*`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (!subbotAccess.publicRequests && !esOwner) {
      return sock.sendMessage(
        from,
        {
          text:
            `*SUBBOTS APAGADOS POR OWNER*\n\n` +
            `Ahora mismo nadie puede pedir codigo.\n` +
            `En este chat: ${chatStatus}`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    const targetNumber = parsed.number || senderNumber;
    const loadingText =
      parsed.slot
        ? `Generando codigo del subbot ${parsed.slot} para ${targetNumber || "tu numero"}...`
        : `Generando codigo para tu subbot ${targetNumber || "automatico"}...`;

    await sock.sendMessage(
      from,
      {
        text:
          `${loadingText}\n` +
          `Modo publico: *${subbotAccess.publicRequests ? "ENCENDIDO" : "APAGADO"}*`,
        ...global.channelInfo,
      },
      quoted
    );

    const result = await runtime.requestBotPairingCode(
      parsed.slot ? `subbot${parsed.slot}` : "subbot",
      {
        number: targetNumber,
        requesterNumber: senderNumber,
        requesterJid: String(sender || ""),
        useCache: !parsed.number,
      }
    );

    if (!result?.ok) {
      let text = result?.message || "No pude obtener el codigo del subbot.";

      if (result?.status === "missing_bot") {
        text =
          `No encontre ese slot de subbot.\n` +
          `Usa un numero del 1 al ${subbotAccess.maxSlots}.`;
      } else if (result?.status === "no_capacity") {
        text =
          `No hay slots libres ahora mismo.\n` +
          `Revisa *${prefix}codigosubbots* para ver quien esta conectado.`;
      } else if (result?.status === "slot_busy") {
        text =
          `${result.message}\n` +
          `Prueba con otro slot o revisa *${prefix}codigosubbots*.`;
      } else if (result?.status === "main_not_ready") {
        text = "Primero vincula y conecta el bot principal desde la consola.";
      } else if (result?.status === "already_linked") {
        text =
          `Ese subbot ya esta vinculado y funcionando.\n` +
          `En este chat: ${chatStatus}`;
      } else if (result?.status === "pending") {
        text =
          "Ya hay una solicitud de codigo en proceso para ese subbot. Espera un momento y vuelve a intentar.";
      } else if (result?.status === "missing_number") {
        const slotHint = parsed.slot ? ` ${parsed.slot}` : "";
        text =
          `No pude detectar tu numero automaticamente.\n` +
          `Usa: *${prefix}subbot${slotHint} 51912345678*`;
      }

      return sock.sendMessage(
        from,
        {
          text,
          ...global.channelInfo,
        },
        quoted
      );
    }

    const slotLabel = result.slot ? ` ${result.slot}` : "";
    const header = result.cached
      ? `CODIGO ACTUAL DEL SUBBOT${slotLabel}`
      : `CODIGO DE VINCULACION DEL SUBBOT${slotLabel}`;

    return sock.sendMessage(
      from,
      {
        text:
          `*${header}*\n\n` +
          `Bot: *${result.displayName}*\n` +
          `Numero: *${result.number}*\n` +
          `Solicitante: *${senderNumber || result.number}*\n` +
          `Codigo: *${result.code}*\n` +
          `Expira aprox: *${formatDuration(result.expiresInMs)}*\n` +
          `En este chat: ${chatStatus}\n\n` +
          `Abre WhatsApp > Dispositivos vinculados > Vincular con numero de telefono.`,
        ...global.channelInfo,
      },
      quoted
    );
  },
};
