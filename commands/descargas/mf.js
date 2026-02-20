import axios from "axios";
import fs from "fs";
import path from "path";

const API_KEY = "dvyer";
const API_URL = "https://api-adonix.ultraplus.click/download/mediafire";
const MAX_MB = 300;

export default {
  command: ["mediafire", "mf"],
  category: "descarga",

  run: async ({ sock, from, args }) => {
    let filePath;

    try {

      if (!args[0]) {
        return sock.sendMessage(from, {
          text: "❌ Usa:\n.mf <link>"
        });
      }

      await sock.sendMessage(from, { text: "📥 Procesando..." });

      const api = `${API_URL}?apikey=${API_KEY}&url=${encodeURIComponent(args[0])}`;
      const { data } = await axios.get(api);

      if (!data.status || !data.result?.link) {
        throw new Error("API inválida");
      }

      const file = data.result;

      // 📂 Ruta temporal
      filePath = path.join("/tmp", file.filename);

      // 🔽 Descargar a /tmp
      const response = await axios({
        method: "GET",
        url: file.link,
        responseType: "stream"
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // 📤 Enviar archivo
      await sock.sendMessage(from, {
        document: fs.readFileSync(filePath),
        fileName: file.filename,
        mimetype: "application/octet-stream"
      });

    } catch (err) {
      console.error("ERROR:", err.message);
      await sock.sendMessage(from, {
        text: "❌ Error enviando archivo."
      });

    } finally {

      // 🔥 BORRAR ARCHIVO SI EXISTE
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("🗑 Archivo eliminado de /tmp");
      }

    }
  }
};
