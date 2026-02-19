import axios from "axios";

const API_KEY = "dvyer";
const API_URL = "https://api-adonix.ultraplus.click/download/mediafire";
const MAX_MB = 300;

export default {
  command: ["mediafire", "mf"],
  category: "descarga",

  run: async ({ sock, from, args }) => {

    try {

      if (!args.length) {
        return sock.sendMessage(from, {
          text: "❌ Usa:\n.mf <link de mediafire>"
        });
      }

      await sock.sendMessage(from, {
        text: "📥 Procesando enlace..."
      });

      const api = `${API_URL}?apikey=${API_KEY}&url=${encodeURIComponent(args[0])}`;
      const { data } = await axios.get(api);

      if (!data.status || !data.result?.link) {
        throw new Error("API inválida");
      }

      const file = data.result;

      // 📦 Detectar tamaño
      let sizeMB = 0;

      if (file.size?.includes("MB")) {
        sizeMB = parseFloat(file.size);
      } else if (file.size?.includes("GB")) {
        sizeMB = parseFloat(file.size) * 1024;
      }

      if (sizeMB > MAX_MB) {
        return sock.sendMessage(from, {
          text:
            `📁 *MediaFire Downloader*\n\n` +
            `📄 Archivo: ${file.filename}\n` +
            `📦 Tamaño: ${file.size}\n\n` +
            `⚠️ Supera el límite de ${MAX_MB}MB\n\n` +
            `🔗 Descargar:\n${file.link}`
        });
      }

      await sock.sendMessage(from, {
        text: `⚡ Enviando archivo (${file.size})...`
      });

      // 🔥 STREAM REAL (sin /tmp)
      const response = await axios({
        method: "GET",
        url: file.link,
        responseType: "stream",
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // 📤 Enviar como documento por stream
      await sock.sendMessage(from, {
        document: response.data,
        fileName: file.filename,
        mimetype: "application/octet-stream",
        caption:
          `📁 *MediaFire Downloader*\n\n` +
          `📄 Archivo: ${file.filename}\n` +
          `📦 Tamaño: ${file.size}\n\n` +
          `🤖 SonGokuBot`
      });

    } catch (err) {

      console.error("MEDIAFIRE STREAM ERROR:", err.message);

      await sock.sendMessage(from, {
        text: "❌ Error enviando archivo."
      });

    }

  }
};