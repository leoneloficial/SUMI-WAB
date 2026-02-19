import yts from "yt-search";

// ✅ Config
const TTL_MS = 20 * 1000; // 20 segundos
const CLEAN_INTERVAL_MS = 1000; // limpia cada 1s

// Guardar búsqueda por "chat + usuario"
const lastSearchByKey = new Map();
/**
 * key = `${from}:${senderJid}`
 * value = { ts, query, results, ownerJid, resultsMsgId }
 */

// Limpieza automática (borra búsquedas viejas)
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of lastSearchByKey.entries()) {
    if (!data || now - data.ts > TTL_MS) {
      lastSearchByKey.delete(key);
    }
  }
}, CLEAN_INTERVAL_MS);

function humanViews(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(".0", "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

function headerBox(title) {
  return `🎵 *${title}*\n────────────────────`;
}

function footerHint() {
  return (
    `────────────────────\n` +
    `✅ MP3: *responde a la lista* y escribe: *.play 1*\n` +
    `🎬 MP4: *responde a la lista* y escribe: *.play video 1*\n` +
    `⏳ La búsqueda dura *20s*`
  );
}

function buildHelp() {
  return (
    headerBox("PLAY") +
    `\n\n` +
    `🔎 *Busca en YouTube* y descarga al elegir.\n\n` +
    `✅ *Buscar*\n` +
    `• *.play <canción o artista>*\n` +
    `Ej: *.play yellow coldplay*\n\n` +
    `✅ *Elegir (solo 20s)*\n` +
    `• Responde al mensaje de resultados y escribe:\n` +
    `  *.play 1* / *.play 2* ...\n\n` +
    `🎬 *Video*\n` +
    `• Responde y escribe: *.play video 1*\n\n` +
    footerHint()
  );
}

function buildResultsMessage(query, videos) {
  const list = videos
    .map((v, i) => {
      const dur = v.timestamp || v.duration?.timestamp || "N/A";
      const chan = v.author?.name || "N/A";
      const views = v.views ? humanViews(v.views) : null;
      const ago = v.ago || null;
      const extra = [views ? `👁️ ${views}` : null, ago ? `📅 ${ago}` : null].filter(Boolean).join(" • ");

      return (
        `*${i + 1})* ${v.title}\n` +
        `⏱️ ${dur}  •  👤 ${chan}` +
        (extra ? `\n${extra}` : "")
      );
    })
    .join("\n\n");

  return (
    headerBox("PLAY — Resultados") +
    `\n🔎 _${query}_\n\n` +
    list +
    `\n\n` +
    footerHint()
  );
}

function buildChosenText(v, isVideoMode) {
  const dur = v.timestamp || v.duration?.timestamp || "N/A";
  const chan = v.author?.name || "N/A";
  const views = v.views ? humanViews(v.views) : null;
  const ago = v.ago || null;
  const extra = [views ? `👁️ ${views}` : null, ago ? `📅 ${ago}` : null].filter(Boolean).join(" • ");

  return (
    headerBox("PLAY — Selección") +
    `\n\n` +
    `✅ *${v.title}*\n` +
    `⏱️ ${dur}  •  👤 ${chan}\n` +
    (extra ? `${extra}\n` : "") +
    `🔗 ${v.url}\n\n` +
    (isVideoMode ? "📥 Descargando *MP4*..." : "🎧 Descargando *MP3*...")
  );
}

function makeExternalPreview({ title, body, thumbnailUrl, sourceUrl }) {
  if (!thumbnailUrl) return undefined;
  return {
    externalAdReply: {
      title: title || "YouTube",
      body: body || "",
      thumbnailUrl,
      sourceUrl: sourceUrl || "",
      mediaType: 1,
      renderLargerThumbnail: true,
      showAdAttribution: false,
    },
  };
}

// ✅ sacar JID del usuario
function getSenderJid(msg, from) {
  return msg?.key?.participant || from;
}

// ✅ obtener el id del mensaje al que respondió (quoted)
function getQuotedMessageId(msg) {
  const m = msg?.message;
  const ctx =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo ||
    null;

  // stanzaId suele ser el ID del mensaje citado
  return ctx?.stanzaId || null;
}

export default {
  name: "play",
  command: ["play"],
  category: "descarga",

  run: async ({ sock, msg, from, args = [], comandos }) => {
    try {
      if (!sock || !from) return;

      const senderJid = getSenderJid(msg, from);
      const key = `${from}:${senderJid}`;

      const input = Array.isArray(args) ? args.join(" ").trim() : String(args ?? "").trim();
      const text = input.replace(/\s+/g, " ");

      // ✅ Ayuda
      if (!text) {
        return await sock.sendMessage(from, { text: buildHelp() }, { quoted: msg });
      }

      // ✅ Modo: "video 1" / "mp4 1"
      const parts = text.split(/\s+/);
      const modeWord = (parts[0] || "").toLowerCase();
      const isVideoMode = ["video", "mp4"].includes(modeWord);
      const maybeNumber = isVideoMode ? parts[1] : parts[0];

      // ✅ Selección por número (OBLIGATORIO responder al mensaje)
      if (/^\d+$/.test(maybeNumber || "")) {
        const data = lastSearchByKey.get(key);

        if (!data?.results?.length) {
          return await sock.sendMessage(
            from,
            { text: "⚠️ No tienes una búsqueda activa. Usa *.play <texto>* y elige en 20s." },
            { quoted: msg }
          );
        }

        // ⏳ Expirada
        if (Date.now() - data.ts > TTL_MS) {
          lastSearchByKey.delete(key);
          return await sock.sendMessage(
            from,
            { text: "⏳ Tu búsqueda expiró (20s). Haz otra: *.play <texto>*" },
            { quoted: msg }
          );
        }

        // 🔒 Debe responder al mensaje de resultados
        const quotedId = getQuotedMessageId(msg);
        if (!quotedId || quotedId !== data.resultsMsgId) {
          return await sock.sendMessage(
            from,
            { text: "📌 *Responde al mensaje de resultados* y escribe: *.play 1*" },
            { quoted: msg }
          );
        }

        const pick = parseInt(maybeNumber, 10);
        if (pick < 1 || pick > data.results.length) {
          return await sock.sendMessage(
            from,
            { text: `⚠️ Elige un número entre 1 y ${data.results.length}.` },
            { quoted: msg }
          );
        }

        const chosen = data.results[pick - 1];

        // Comando real
        const cmdName = isVideoMode ? "ytmp4" : "ytmp3";
        const cmd = comandos?.get?.(cmdName);

        if (!cmd || typeof cmd.run !== "function") {
          return await sock.sendMessage(
            from,
            {
              text:
                headerBox("PLAY") +
                `\n\n✅ Elegiste: *${chosen.title}*\n` +
                `🔗 ${chosen.url}\n\n` +
                `⚠️ No encontré el comando *${cmdName}*.\n` +
                `Usa manual:\n• *.ytmp3 ${chosen.url}*`,
            },
            { quoted: msg }
          );
        }

        // ✅ Miniatura del ELEGIDO
        const dur = chosen.timestamp || chosen.duration?.timestamp || "N/A";
        const chan = chosen.author?.name || "N/A";
        const chosenPreview = makeExternalPreview({
          title: chosen.title,
          body: `⏱ ${dur} • 👤 ${chan}`,
          thumbnailUrl: chosen.thumbnail,
          sourceUrl: chosen.url,
        });

        await sock.sendMessage(
          from,
          { text: buildChosenText(chosen, isVideoMode), contextInfo: chosenPreview },
          { quoted: msg }
        );

        // Ejecuta ytmp3/ytmp4 internamente
        await cmd.run({
          sock,
          msg,
          from,
          args: [chosen.url],
          comandos,
        });

        // ✅ Una vez elegido, borramos para que no reutilicen después
        lastSearchByKey.delete(key);
        return;
      }

      // ✅ Protección query larga
      if (text.length > 120) {
        return await sock.sendMessage(
          from,
          { text: "⚠️ Tu búsqueda es muy larga. Máx 120 caracteres." },
          { quoted: msg }
        );
      }

      // ✅ Buscar
      await sock.sendMessage(
        from,
        { text: `${headerBox("PLAY")}\n\n🔎 Buscando: *${text}* ...` },
        { quoted: msg }
      );

      const res = await yts(text);
      const videosAll = Array.isArray(res?.videos) ? res.videos : [];
      const videos = videosAll.filter(v => v?.url && v?.title).slice(0, 5);

      if (!videos.length) {
        return await sock.sendMessage(
          from,
          { text: "❌ No encontré resultados. Prueba con otro texto." },
          { quoted: msg }
        );
      }

      // ✅ Miniatura del TOP
      const top = videos[0];
      const topDur = top.timestamp || top.duration?.timestamp || "N/A";
      const topChan = top.author?.name || "N/A";
      const topPreview = makeExternalPreview({
        title: `Top: ${top.title}`,
        body: `⏱ ${topDur} • 👤 ${topChan}`,
        thumbnailUrl: top.thumbnail,
        sourceUrl: top.url,
      });

      // Mandar lista y guardar el ID del mensaje enviado
      const sent = await sock.sendMessage(
        from,
        { text: buildResultsMessage(text, videos), contextInfo: topPreview },
        { quoted: msg }
      );

      // ✅ Guardar búsqueda por usuario + id del mensaje de resultados
      lastSearchByKey.set(key, {
        ts: Date.now(),
        query: text,
        results: videos,
        ownerJid: senderJid,
        resultsMsgId: sent?.key?.id || null,
      });

      // Si por algún motivo no pudimos guardar el msgId, igual sirve TTL,
      // pero la regla "responde al mensaje" no podría validarse.
    } catch (err) {
      console.error("[PLAY] Error:", err);
      try {
        await sock.sendMessage(from, { text: "❌ Error en *play*. Revisa consola." }, { quoted: msg });
      } catch {}
    }
  },
};
