import fs from "fs";
import path from "path";
import { awardGameCoins } from "../economia/_shared.js";

const DB_DIR = path.join(process.cwd(), "database");
const STATS_FILE = path.join(DB_DIR, "games-stats.json");
const SESSIONS_FILE = path.join(DB_DIR, "games-sessions.json");
const SESSION_TTL_MS = 10 * 60 * 1000;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function safeJsonParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return fallback;
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return safeJsonParse(fs.readFileSync(filePath, "utf-8"), fallback);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeMapObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStats(data = {}) {
  const source = normalizeMapObject(data);
  return {
    trackedSince:
      String(source.trackedSince || "").trim() || new Date().toISOString(),
    users: normalizeMapObject(source.users),
  };
}

function normalizeSessions(data = {}) {
  return normalizeMapObject(data);
}

const statsState = normalizeStats(readJson(STATS_FILE, {}));
const sessionsState = normalizeSessions(readJson(SESSIONS_FILE, {}));

let statsSaveTimer = null;
let sessionsSaveTimer = null;

function scheduleStatsSave() {
  if (statsSaveTimer) return;
  statsSaveTimer = setTimeout(() => {
    statsSaveTimer = null;
    writeJson(STATS_FILE, statsState);
  }, 1000);
  statsSaveTimer.unref?.();
}

function scheduleSessionsSave() {
  if (sessionsSaveTimer) return;
  sessionsSaveTimer = setTimeout(() => {
    sessionsSaveTimer = null;
    writeJson(SESSIONS_FILE, sessionsState);
  }, 800);
  sessionsSaveTimer.unref?.();
}

function sanitizeCounter(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

export function normalizeJidUser(value = "") {
  const jid = String(value || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

export function formatUserLabel(value = "") {
  const digits = normalizeJidUser(value).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : normalizeJidUser(value) || "Desconocido";
}

export function formatChatLabel(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "Desconocido";
  if (raw.endsWith("@g.us")) return `Grupo ${raw.split("@")[0]}`;
  return formatUserLabel(raw);
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatDateTime(value) {
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

export function isCommandText(text, settings) {
  const normalized = String(text || "").trim();
  const prefixes = Array.isArray(settings?.prefix)
    ? settings.prefix.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(settings?.prefix || ".").trim() || "."];

  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function ensureUserProfile(userId) {
  const normalizedId = normalizeJidUser(userId);
  if (!normalizedId) return null;

  if (!statsState.users[normalizedId]) {
    statsState.users[normalizedId] = {
      id: normalizedId,
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      lastPlayedAt: "",
      games: {},
      groups: {},
      groupGames: {},
    };
  }

  const profile = statsState.users[normalizedId];

  if (!profile.games || typeof profile.games !== "object" || Array.isArray(profile.games)) {
    profile.games = {};
  }

  if (!profile.groups || typeof profile.groups !== "object" || Array.isArray(profile.groups)) {
    profile.groups = {};
  }

  if (
    !profile.groupGames ||
    typeof profile.groupGames !== "object" ||
    Array.isArray(profile.groupGames)
  ) {
    profile.groupGames = {};
  }

  return profile;
}

function ensureGameProfile(userProfile, game) {
  if (!userProfile.games[game]) {
    userProfile.games[game] = {
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      lastPlayedAt: "",
    };
  }

  return userProfile.games[game];
}

function ensureGroupProfile(userProfile, chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return null;

  if (!userProfile.groups[normalizedChatId]) {
    userProfile.groups[normalizedChatId] = {
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      lastPlayedAt: "",
    };
  }

  return userProfile.groups[normalizedChatId];
}

function ensureGroupGameProfile(userProfile, chatId, game) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return null;

  if (!userProfile.groupGames[normalizedChatId]) {
    userProfile.groupGames[normalizedChatId] = {};
  }

  if (!userProfile.groupGames[normalizedChatId][game]) {
    userProfile.groupGames[normalizedChatId][game] = {
      points: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      lastPlayedAt: "",
    };
  }

  return userProfile.groupGames[normalizedChatId][game];
}

export function recordGameResult({
  userId,
  chatId,
  game,
  points = 0,
  outcome = "win",
}) {
  const profile = ensureUserProfile(userId);
  if (!profile) return null;

  const now = new Date().toISOString();
  const normalizedOutcome = ["win", "loss", "draw"].includes(outcome)
    ? outcome
    : "draw";
  const gameProfile = ensureGameProfile(profile, game);
  const groupProfile = ensureGroupProfile(profile, chatId);
  const groupGameProfile = ensureGroupGameProfile(profile, chatId, game);

  const applyOutcome = (target) => {
    target.points = sanitizeCounter(target.points) + sanitizeCounter(points);
    target.played = sanitizeCounter(target.played) + 1;
    target.lastPlayedAt = now;

    if (normalizedOutcome === "win") {
      target.wins = sanitizeCounter(target.wins) + 1;
      target.streak = sanitizeCounter(target.streak) + 1;
      target.bestStreak = Math.max(
        sanitizeCounter(target.bestStreak),
        sanitizeCounter(target.streak)
      );
    } else if (normalizedOutcome === "loss") {
      target.losses = sanitizeCounter(target.losses) + 1;
      target.streak = 0;
    } else {
      target.draws = sanitizeCounter(target.draws) + 1;
      target.streak = 0;
    }
  };

  applyOutcome(profile);
  applyOutcome(gameProfile);
  if (groupProfile) applyOutcome(groupProfile);
  if (groupGameProfile) applyOutcome(groupGameProfile);

  profile.lastPlayedAt = now;
  awardGameCoins({
    userId,
    chatId,
    game,
    outcome: normalizedOutcome,
    points,
  });
  scheduleStatsSave();
  return { profile, gameProfile, groupProfile, groupGameProfile };
}

function purgeExpiredSession(chatId) {
  const key = String(chatId || "").trim();
  const session = sessionsState[key];
  if (!session) return null;

  if (Number(session.expiresAt || 0) > Date.now()) {
    return session;
  }

  delete sessionsState[key];
  scheduleSessionsSave();
  return null;
}

export function getActiveSession(chatId) {
  return purgeExpiredSession(chatId);
}

export function setActiveSession(chatId, session) {
  const key = String(chatId || "").trim();
  if (!key) return null;

  sessionsState[key] = {
    ...session,
    chatId: key,
    createdAt: Number(session.createdAt || Date.now()),
    updatedAt: Date.now(),
    expiresAt: Number(session.expiresAt || Date.now() + SESSION_TTL_MS),
  };
  scheduleSessionsSave();
  return sessionsState[key];
}

export function updateActiveSession(chatId, updates = {}) {
  const current = getActiveSession(chatId);
  if (!current) return null;

  return setActiveSession(chatId, {
    ...current,
    ...updates,
    expiresAt: Number(updates.expiresAt || Date.now() + SESSION_TTL_MS),
  });
}

export function clearActiveSession(chatId) {
  const key = String(chatId || "").trim();
  if (!key || !sessionsState[key]) return false;
  delete sessionsState[key];
  scheduleSessionsSave();
  return true;
}

export function ensureSessionAvailable(chatId) {
  return !getActiveSession(chatId);
}

export function buildActiveSessionMessage(prefix, session) {
  return (
    `Ya hay un juego activo en este chat.\n\n` +
    `Juego: *${String(session?.game || "desconocido").toUpperCase()}*\n` +
    `Jugador: *${formatUserLabel(session?.userId || "")}*\n` +
    `Expira aprox: *${formatDuration(Math.max(0, Number(session?.expiresAt || 0) - Date.now()))}*\n\n` +
    `Termina ese juego o usa *${prefix}salirjuego* para liberarlo.`
  );
}

export function getUserGameProfile(userId) {
  const profile = ensureUserProfile(userId);
  scheduleStatsSave();
  return profile;
}

export function getGameLeaderboard({ game = "", chatId = "", limit = 10 } = {}) {
  const normalizedGame = String(game || "").trim().toLowerCase();
  const normalizedChatId = String(chatId || "").trim();
  const entries = [];

  for (const [userId, userProfile] of Object.entries(statsState.users)) {
    let source = userProfile;

    if (normalizedChatId && normalizedGame) {
      source = normalizeMapObject(
        userProfile.groupGames?.[normalizedChatId]?.[normalizedGame]
      );
    } else if (normalizedChatId) {
      source = normalizeMapObject(userProfile.groups?.[normalizedChatId]);
    } else if (normalizedGame) {
      source = normalizeMapObject(userProfile.games?.[normalizedGame]);
    }

    const points = sanitizeCounter(source.points);
    const wins = sanitizeCounter(source.wins);
    const played = sanitizeCounter(source.played);

    if (points <= 0 && wins <= 0 && played <= 0) continue;

    entries.push({
      userId,
      points,
      wins,
      played,
      draws: sanitizeCounter(source.draws),
      losses: sanitizeCounter(source.losses),
      bestStreak: sanitizeCounter(source.bestStreak),
    });
  }

  return entries
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.played !== a.played) return b.played - a.played;
      return a.userId.localeCompare(b.userId);
    })
    .slice(0, Math.max(1, Math.min(20, Number(limit || 10))));
}

export function getGamesStatsOverview() {
  const profiles = Object.values(statsState.users);
  return {
    trackedSince: statsState.trackedSince,
    players: profiles.length,
    totalPoints: profiles.reduce((sum, item) => sum + sanitizeCounter(item.points), 0),
    totalPlayed: profiles.reduce((sum, item) => sum + sanitizeCounter(item.played), 0),
  };
}

export function randomItem(items = []) {
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffleArray(items = []) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[nextIndex]] = [clone[nextIndex], clone[index]];
  }
  return clone;
}

export function scrambleWord(word = "") {
  const letters = String(word || "").split("");
  let scrambled = shuffleArray(letters).join("");

  while (scrambled.toLowerCase() === String(word || "").toLowerCase()) {
    scrambled = shuffleArray(letters).join("");
  }

  return scrambled;
}

export function buildTicTacToeBoard(board = []) {
  const values = Array.from({ length: 9 }, (_, index) => board[index] || String(index + 1));
  return (
    `${values[0]} | ${values[1]} | ${values[2]}\n` +
    `---------\n` +
    `${values[3]} | ${values[4]} | ${values[5]}\n` +
    `---------\n` +
    `${values[6]} | ${values[7]} | ${values[8]}`
  );
}

export function getTicTacToeWinner(board = []) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return board.every(Boolean) ? "draw" : "";
}

export function pickBestTicTacToeMove(board = []) {
  const candidates = board.map((value, index) => (!value ? index : -1)).filter((value) => value >= 0);

  const tryMove = (symbol) => {
    for (const index of candidates) {
      const next = [...board];
      next[index] = symbol;
      if (getTicTacToeWinner(next) === symbol) {
        return index;
      }
    }
    return -1;
  };

  const winMove = tryMove("O");
  if (winMove >= 0) return winMove;

  const blockMove = tryMove("X");
  if (blockMove >= 0) return blockMove;

  if (candidates.includes(4)) return 4;

  const corners = [0, 2, 6, 8].filter((index) => candidates.includes(index));
  if (corners.length) return randomItem(corners);

  return randomItem(candidates);
}
