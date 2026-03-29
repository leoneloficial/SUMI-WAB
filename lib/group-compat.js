function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeJidUser(value = "") {
  const jid = String(value || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

export function normalizeJidDigits(value = "") {
  return normalizeJidUser(value).replace(/[^\d]/g, "");
}

function pushMatchKeys(target, value = "") {
  const raw = String(value || "").trim();
  if (!raw) return;

  target.add(raw.toLowerCase());

  const normalized = normalizeJidUser(raw);
  if (normalized) {
    target.add(normalized.toLowerCase());
  }

  const digits = normalizeJidDigits(raw);
  if (digits) {
    target.add(digits);
  }
}

export function getMatchKeys(value = "") {
  const output = new Set();
  pushMatchKeys(output, value);
  return output;
}

export function getParticipantMatchKeys(participant = {}) {
  const output = new Set();

  for (const value of [
    participant?.id,
    participant?.lid,
    participant?.jid,
    participant?.pn,
    participant?.phone_number,
  ]) {
    pushMatchKeys(output, value);
  }

  return output;
}

export function isParticipantAdmin(participant = {}) {
  return Boolean(participant?.admin);
}

export function isParticipantSuperAdmin(participant = {}) {
  return String(participant?.admin || "").trim().toLowerCase() === "superadmin";
}

export function findGroupParticipant(metadata = {}, values = []) {
  const candidates = Array.isArray(values) ? values : [values];
  const wanted = new Set();

  for (const value of candidates) {
    for (const key of getMatchKeys(value)) {
      wanted.add(key);
    }
  }

  if (!wanted.size) {
    return null;
  }

  const participants = Array.isArray(metadata?.participants)
    ? metadata.participants
    : [];

  for (const participant of participants) {
    const participantKeys = getParticipantMatchKeys(participant);
    for (const key of participantKeys) {
      if (wanted.has(key)) {
        return participant;
      }
    }
  }

  return null;
}

export function isGroupMetadataOwner(metadata = {}, values = []) {
  const candidates = Array.isArray(values) ? values : [values];
  const wanted = new Set();

  for (const value of candidates) {
    for (const key of getMatchKeys(value)) {
      wanted.add(key);
    }
  }

  if (!wanted.size) {
    return false;
  }

  const ownerCandidates = [
    metadata?.owner,
    metadata?.ownerAlt,
    metadata?.subjectOwner,
    metadata?.subjectOwnerAlt,
    metadata?.descOwner,
    metadata?.descOwnerAlt,
  ];

  for (const value of ownerCandidates) {
    for (const key of getMatchKeys(value)) {
      if (wanted.has(key)) {
        return true;
      }
    }
  }

  return false;
}

export function buildJidCandidates(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const values = [];
  const normalized = normalizeJidUser(raw);
  const digits = normalizeJidDigits(raw);
  const looksPhoneLike =
    /^\+?\d+$/.test(raw) ||
    /^\d+(?:@s\.whatsapp\.net)?$/i.test(raw) ||
    /^\d+@lid$/i.test(raw) ||
    /^\d+$/.test(normalized);

  if (raw.includes("@")) {
    values.push(raw);
  }

  if (looksPhoneLike && digits) {
    values.push(`${digits}@s.whatsapp.net`, `${digits}@lid`);
  }

  return uniqueValues(values);
}

export function getParticipantActionCandidates(
  metadata = {},
  participant = null,
  fallbackValues = []
) {
  const preferLid = String(metadata?.addressingMode || "").trim().toLowerCase() === "lid";
  const candidates = [];

  const push = (value = "") => {
    const raw = String(value || "").trim();
    if (raw) {
      candidates.push(raw);
    }
  };

  if (participant) {
    if (preferLid) {
      push(participant?.lid);
      push(participant?.id);
    } else {
      push(participant?.id);
      push(participant?.lid);
    }
  }

  for (const value of Array.isArray(fallbackValues) ? fallbackValues : [fallbackValues]) {
    push(value);
    for (const candidate of buildJidCandidates(value)) {
      push(candidate);
    }
  }

  return uniqueValues(candidates);
}

export function getParticipantMentionJid(metadata = {}, participant = null, fallbackValue = "") {
  return (
    getParticipantActionCandidates(metadata, participant, fallbackValue)[0] || ""
  );
}

export async function runGroupParticipantAction(
  sock,
  groupId,
  metadata = {},
  participant = null,
  fallbackValues = [],
  action = "remove"
) {
  const candidates = getParticipantActionCandidates(
    metadata,
    participant,
    fallbackValues
  );
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const result = await sock.groupParticipantsUpdate(groupId, [candidate], action);
      const ok =
        !Array.isArray(result) ||
        result.some((entry) => String(entry?.status || "200").trim() === "200");

      if (ok) {
        return {
          ok: true,
          jid: candidate,
          result,
        };
      }

      lastError = new Error(
        `No pude ejecutar ${action} para ${candidate}.`
      );
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    candidates,
    error: lastError,
  };
}

export function getParticipantDisplayTag(participant = null, fallbackValue = "") {
  const digits =
    normalizeJidDigits(participant?.id) ||
    normalizeJidDigits(participant?.lid) ||
    normalizeJidDigits(fallbackValue);

  if (digits) {
    return `@${digits}`;
  }

  const normalized =
    normalizeJidUser(participant?.id) ||
    normalizeJidUser(participant?.lid) ||
    normalizeJidUser(fallbackValue);

  return normalized ? `@${normalized}` : "@usuario";
}

function getContextInfo(message = {}) {
  const candidates = [
    message?.extendedTextMessage?.contextInfo,
    message?.imageMessage?.contextInfo,
    message?.videoMessage?.contextInfo,
    message?.documentMessage?.contextInfo,
    message?.buttonsResponseMessage?.contextInfo,
    message?.templateButtonReplyMessage?.contextInfo,
    message?.listResponseMessage?.contextInfo,
    message?.interactiveResponseMessage?.contextInfo,
  ];

  return candidates.find((value) => value && typeof value === "object") || {};
}

export function extractTargetCandidates(message = {}, args = []) {
  const contextInfo = getContextInfo(message?.message || message || {});
  const mentioned = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid
    : [];
  const quotedParticipant = String(contextInfo?.participant || "").trim();
  const quotedParticipantAlt = String(
    contextInfo?.participantAlt || contextInfo?.participantPn || ""
  ).trim();
  const quotedParticipantLid = String(contextInfo?.participantLid || "").trim();
  const values = [
    ...mentioned,
    quotedParticipant,
    quotedParticipantAlt,
    quotedParticipantLid,
    String(message?.quoted?.sender || "").trim(),
    String(message?.quoted?.senderPhone || "").trim(),
    String(message?.quoted?.senderLid || "").trim(),
    String(message?.quoted?.key?.participant || "").trim(),
    String(message?.quoted?.key?.participantAlt || "").trim(),
    String(message?.quoted?.key?.participantPn || "").trim(),
    String(message?.quoted?.key?.participantLid || "").trim(),
  ];

  const firstArg = String((Array.isArray(args) ? args[0] : args) || "").trim();
  if (firstArg) {
    values.push(firstArg);
  }

  return uniqueValues(values);
}

export function resolveGroupTarget(metadata = {}, message = {}, args = []) {
  const candidates = extractTargetCandidates(message, args);
  const participant = findGroupParticipant(metadata, candidates);
  const jid = getParticipantMentionJid(metadata, participant, candidates[0] || "");

  return {
    participant,
    jid,
    candidates,
  };
}
