import {
  getParticipantDisplayTag,
  getParticipantMentionJid,
} from "../../lib/group-compat.js";

export default {
  command: ["tagall"],
  category: "grupo",
  description: "Etiqueta a todos",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from, args }) => {
    const meta = await sock.groupMetadata(from);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];
    const members = participants
      .map((participant) => getParticipantMentionJid(meta, participant, participant?.id))
      .filter(Boolean);

    const texto = args.length
      ? args.join(" ")
      : "📣 *Tagall*";

    const lines = participants
      .map((participant) => `• ${getParticipantDisplayTag(participant, participant?.id)}`)
      .join("\n");

    return sock.sendMessage(
      from,
      {
        text: `${texto}\n\n${lines}`,
        mentions: members,
        ...global.channelInfo
      },
      { quoted: msg }
    );
  }
};
