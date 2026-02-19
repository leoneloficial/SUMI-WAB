import yts from "yt-search";

// Guarda la última búsqueda por chat (jid)
const lastSearchByChat = new Map();

// Limpieza automática cada minuto (borra búsquedas viejas)
setInterval(() => {
  const now = Date.now();
  for (const [jid, data] of lastSearchByChat.entries()) {
    if (!data || now - data.ts > 10 * 60 * 1000) lastSearchByChat.delete(jid);
  }
}, 60 * 1000);

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
    `✅ MP3: *.play 1*\n` +
    `🎬 MP4: *.play video 1*\n` +
    `🧹 Cancelar: *.play cancel*`
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
    `✅ *Elegir (descarga MP3)*\n` +
    `• *.play 1* / *.play 2* ...\n\n` +
    `✅ *Elegir Video (MP4)*\n` +
    `• *.play video 1* / *.play mp4 1*\n\n` +
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

export default {
  name: "play",
  command: ["play"],
  category: "music",

  run: async ({ sock, msg, from, args = [], comandos }) => {
    try {
      if (!sock || !from) return;

      const input = Array.isArray(args) ? args.join(" ").trim() : String(args ?? "").trim();
      const text = input.replace(/\s+/g, " ");

      // ✅ Ayuda
      if (!text) {
        return await sock.sendMessage(from, { text: buildHelp() }, { quoted: msg });
      }

      // ✅ Cancelar búsqueda guardada
      if (["cancel", "cancelar", "stop", "salir"].includes(text.toLowerCase())) {
        lastSearchByChat.delete(from);
        return await sock.sendMessage(
          from,
          { text: "🧹 Listo. Búsqueda borrada. Usa *.play <texto>* para buscar de nuevo." },
          { quoted: msg }
        );
      }

      // ✅ Modo: "video 1" para MP4 / "mp4 1"
      const parts = text.split(/\s+/);
      const modeWord = (parts[0] || "").toLowerCase();
      const isVideoMode = ["video", "mp4"].includes(modeWord);
      const maybeNumber = isVideoMode ? parts[1] : parts[0];

      // ✅ Elegir número
      if (/^\d+$/.test(maybeNumber || "")) {
        const pick = parseInt(maybeNumber, 10);
        const data = lastSearchByChat.get(from);

        if (!data?.results?.length) {
          return await sock.sendMessage(
            from,
            { text: "⚠️ No tengo una búsqueda guardada. Usa *.play <texto>* primero." },
            { quoted: msg }
          );
        }

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

        // ✅ Miniatura del ELEGIDO antes de descargar
        const dur = chosen.timestamp || chosen.duration?.timestamp || "N/A";
        const chan = chosen.author?.name || "N/A";
        const preview = makeExternalPreview({
          title: chosen.title,
          body: `⏱ ${dur} • 👤 ${chan}`,
          thumbnailUrl: chosen.thumbnail,
          sourceUrl: chosen.url,
        });

        await sock.sendMessage(
          from,
          {
            text: buildChosenText(chosen, isVideoMode),
            contextInfo: preview,
          },
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

        return;
      }

      // ✅ Protección: query demasiado larga
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

      // Guardar resultados
      lastSearchByChat.set(from, { ts: Date.now(), query: text, results: videos });

      // ✅ Miniatura del TOP resultado al mostrar lista
      const top = videos[0];
      const topDur = top.timestamp || top.duration?.timestamp || "N/A";
      const topChan = top.author?.name || "N/A";
      const topPreview = makeExternalPreview({
        title: `Top: ${top.title}`,
        body: `⏱ ${topDur} • 👤 ${topChan}`,
        thumbnailUrl: top.thumbnail,
        sourceUrl: top.url,
      });

      await sock.sendMessage(
        from,
        {
          text: buildResultsMessage(text, videos),
          contextInfo: topPreview,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error("[PLAY] Error:", err);
      try {
        await sock.sendMessage(from, { text: "❌ Error en *play*. Revisa consola." }, { quoted: msg });
      } catch {}
    }
  },
};
