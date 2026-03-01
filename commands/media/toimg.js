import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const TMP_DIR = path.join(process.cwd(), "tmp");

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function randName(ext) {
  return `${Date.now()}_${Math.floor(Math.random() * 99999)}.${ext}`;
}

function webpToPng(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat("png")
      .on("end", resolve)
      .on("error", reject)
      .save(output);
  });
}

export default {
  command: ["toimg", "img"],
  category: "media",
  description: "Sticker a imagen",
  run: async ({ sock, msg, from }) => {
    try {
      ensureTmp();

      const q =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;

      const isQuotedSticker = !!q?.stickerMessage;
      if (!isQuotedSticker) {
        return sock.sendMessage(
          from,
          { text: "⚙️ Usa: responde a un *sticker* con .toimg", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const dlMsg = { message: q };
      const buff = await sock.downloadMediaMessage(dlMsg);

      const inFile = path.join(TMP_DIR, randName("webp"));
      const outFile = path.join(TMP_DIR, randName("png"));

      fs.writeFileSync(inFile, buff);
      await webpToPng(inFile, outFile);

      const png = fs.readFileSync(outFile);
      fs.unlinkSync(inFile);
      fs.unlinkSync(outFile);

      return sock.sendMessage(
        from,
        { image: png, caption: "✅ Convertido a imagen.", ...global.channelInfo },
        { quoted: msg }
      );
    } catch (e) {
      console.error("toimg error:", e);
      return sock.sendMessage(from, { text: "❌ Error convirtiendo sticker.", ...global.channelInfo }, { quoted: msg });
    }
  }
};
