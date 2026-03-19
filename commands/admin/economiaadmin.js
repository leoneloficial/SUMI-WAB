import fs from "fs";
import path from "path";
import {
  addCoins,
  addDownloadRequests,
  formatCoins,
  getDownloadRequestState,
  getEconomyConfig,
  getEconomyProfile,
  getPrefix,
  removeCoins,
  removeDownloadRequests,
  setCoinsBalance,
  setDownloadRequests,
} from "../economia/_shared.js";
import { formatDateTime } from "../sistema/_shared.js";

const SETTINGS_FILE = path.join(process.cwd(), "settings", "settings.json");

function normalizeTarget(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function getStatusText(settings) {
  const config = getEconomyConfig(settings);
  return (
    `*ECONOMIA ADMIN*\n\n` +
    `Cobro de descargas: *${config.downloadBillingEnabled ? "ACTIVO" : "APAGADO"}*\n` +
    `Solicitudes diarias: *${config.dailyDownloadRequests}*\n` +
    `Precio por solicitud: *${formatCoins(config.requestPrice)}*`
  );
}

export default {
  name: "economiaadmin",
  command: ["economiaadmin", "billing", "cobrodescargas", "ecoadmin", "economyadmin"],
  category: "admin",
  ownerOnly: true,
  description: "Administra el cobro de descargas, dolares y solicitudes",

  run: async ({ sock, msg, from, args = [], settings }) => {
    let action = String(args[0] || "status").trim().toLowerCase();
    const prefix = getPrefix(settings);

    if (["on", "off", "activar", "desactivar", "enable", "disable"].includes(action)) {
      args = ["mode", ["activar", "enable"].includes(action) ? "on" : ["desactivar", "disable"].includes(action) ? "off" : action, ...args.slice(1)];
      action = "mode";
    }

    if (["gratis", "limite", "límite"].includes(action)) {
      action = "daily";
    }

    if (["cost", "costo", "coste"].includes(action)) {
      action = "price";
    }

    if (["adddolares", "sumardolares", "agregardolares"].includes(action)) {
      action = "addusd";
    }

    if (["quitardolares", "removedolares", "restardolares"].includes(action)) {
      action = "removeusd";
    }

    if (["fijardolares", "setdolares", "saldofijo"].includes(action)) {
      action = "setusd";
    }

    if (["addsolicitudes", "sumarsolicitudes", "agregarsolicitudes"].includes(action)) {
      action = "addreq";
    }

    if (["quitarsolicitudes", "removesolicitudes", "restarsolicitudes"].includes(action)) {
      action = "removereq";
    }

    if (["fijarsolicitudes", "setsolicitudes", "solicitudesfijas"].includes(action)) {
      action = "setreq";
    }

    if (["status", "estado", "info"].includes(action)) {
      return sock.sendMessage(
        from,
        {
          text: getStatusText(settings),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "mode" || action === "modo") {
      const value = String(args[1] || "").trim().toLowerCase();
      if (!["on", "off"].includes(value)) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}economiaadmin mode on* o *${prefix}economiaadmin mode off*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      settings.system = settings.system || {};
      settings.system.economy = settings.system.economy || {};
      settings.system.economy.downloadBillingEnabled = value === "on";
      saveSettings(settings);

      return sock.sendMessage(
        from,
        {
          text:
            `Cobro de descargas *${value === "on" ? "activado" : "desactivado"}*.\n\n` +
            getStatusText(settings),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "daily") {
      const amount = Math.max(0, Math.floor(Number(args[1] || 0)));
      if (!amount) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}economiaadmin daily 50*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      settings.system = settings.system || {};
      settings.system.economy = settings.system.economy || {};
      settings.system.economy.dailyDownloadRequests = amount;
      saveSettings(settings);

      return sock.sendMessage(
        from,
        {
          text: `Solicitudes diarias actualizadas a *${amount}* por usuario.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "price" || action === "precio") {
      const amount = Math.max(1, Math.floor(Number(args[1] || 0)));
      if (!amount) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}economiaadmin price 25*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      settings.system = settings.system || {};
      settings.system.economy = settings.system.economy || {};
      settings.system.economy.requestPrice = amount;
      saveSettings(settings);

      return sock.sendMessage(
        from,
        {
          text: `Precio por solicitud actualizado a *${formatCoins(amount)}*.`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "perfil" || action === "user") {
      const target = normalizeTarget(args[1]);
      if (!target) {
        return sock.sendMessage(
          from,
          {
            text: `Usa: *${prefix}economiaadmin perfil 519xxxxxxxx*`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const profile = getEconomyProfile(target, settings);
      const requests = getDownloadRequestState(target, settings);
      return sock.sendMessage(
        from,
        {
          text:
            `*PERFIL ECONOMICO*\n\n` +
            `Nombre: *${profile?.lastKnownName || "Sin nombre"}*\n` +
            `Usuario: *${target.replace("@s.whatsapp.net", "")}*\n` +
            `JID: *${profile?.jid || target}*\n` +
            `Saldo: *${formatCoins(profile?.coins || 0)}*\n` +
            `Banco: *${formatCoins(profile?.bank || 0)}*\n` +
            `Solicitudes hoy: *${requests?.dailyRemaining || 0}/${requests?.dailyLimit || 0}*\n` +
            `Solicitudes extra: *${requests?.extraRemaining || 0}*\n` +
            `Comandos usados: *${profile?.commandCount || 0}*\n` +
            `Ultimo comando: *${profile?.lastCommand || "Sin registro"}*\n` +
            `Ultimo bot: *${profile?.lastBotId || "Sin registro"}*\n` +
            `Registrado: *${formatDateTime(profile?.registeredAt)}*\n` +
            `Ultima actividad: *${formatDateTime(profile?.lastSeenAt)}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const target = normalizeTarget(args[1]);
    const amount = Math.max(0, Math.floor(Number(args[2] || 0)));

    if (!target || !amount) {
      return sock.sendMessage(
        from,
        {
          text:
            `Usos:\n` +
            `${prefix}economiaadmin on\n` +
            `${prefix}economiaadmin off\n` +
            `${prefix}economiaadmin daily 50\n` +
            `${prefix}economiaadmin price 25\n` +
            `${prefix}economiaadmin adddolares 519xxxxxxxx 500\n` +
            `${prefix}economiaadmin quitardolares 519xxxxxxxx 200\n` +
            `${prefix}economiaadmin setdolares 519xxxxxxxx 1000\n` +
            `${prefix}economiaadmin addsolicitudes 519xxxxxxxx 20\n` +
            `${prefix}economiaadmin quitarsolicitudes 519xxxxxxxx 5\n` +
            `${prefix}economiaadmin setreq 519xxxxxxxx 40`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    let text = "No pude completar la accion.";

    if (action === "addusd") {
      const user = addCoins(target, amount, "owner_add_usd", { by: "owner" });
      const requests = getDownloadRequestState(target, settings);
      text =
        `Dolares agregados a *${target.replace("@s.whatsapp.net", "")}*.\n` +
        `Saldo: *${formatCoins(user?.coins || 0)}*\n` +
        `Solicitudes disponibles: *${requests?.available || 0}*`;
    } else if (action === "removeusd") {
      const result = removeCoins(target, amount, "owner_remove_usd", { by: "owner" });
      if (!result.ok) {
        text = `No se pudo descontar esa cantidad.\nFaltan: *${formatCoins(result.missing || 0)}*`;
      } else {
        const requests = getDownloadRequestState(target, settings);
        text =
          `Dolares descontados a *${target.replace("@s.whatsapp.net", "")}*.\n` +
          `Saldo: *${formatCoins(result.user?.coins || 0)}*\n` +
          `Solicitudes disponibles: *${requests?.available || 0}*`;
      }
    } else if (action === "setusd") {
      const user = setCoinsBalance(target, amount, "owner_set_usd", { by: "owner" });
      const requests = getDownloadRequestState(target, settings);
      text =
        `Saldo fijado para *${target.replace("@s.whatsapp.net", "")}*.\n` +
        `Saldo: *${formatCoins(user?.coins || 0)}*\n` +
        `Solicitudes disponibles: *${requests?.available || 0}*`;
    } else if (action === "addreq") {
      const result = addDownloadRequests(target, amount, "owner_add_req", { by: "owner" }, settings);
      text =
        `Solicitudes extra agregadas a *${target.replace("@s.whatsapp.net", "")}*.\n` +
        `Extras: *${result.requests?.extraRemaining || 0}*\n` +
        `Disponibles: *${result.requests?.available || 0}*`;
    } else if (action === "removereq") {
      const result = removeDownloadRequests(
        target,
        amount,
        "owner_remove_req",
        { by: "owner" },
        settings
      );
      if (!result.ok) {
        text =
          `No se pudo quitar esa cantidad.\n` +
          `Faltan extras por descontar: *${result.missing || 0}*`;
      } else {
        text =
          `Solicitudes extra descontadas a *${target.replace("@s.whatsapp.net", "")}*.\n` +
          `Extras: *${result.requests?.extraRemaining || 0}*\n` +
          `Disponibles: *${result.requests?.available || 0}*`;
      }
    } else if (action === "setreq") {
      const result = setDownloadRequests(
        target,
        amount,
        "owner_set_req",
        { by: "owner" },
        settings
      );
      text =
        `Solicitudes extra fijadas para *${target.replace("@s.whatsapp.net", "")}*.\n` +
        `Extras: *${result.requests?.extraRemaining || 0}*\n` +
        `Disponibles: *${result.requests?.available || 0}*`;
    } else {
      text = `Accion no reconocida. Usa *${prefix}economiaadmin status* para ver opciones.`;
    }

    await sock.sendMessage(
      from,
      {
        text,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
