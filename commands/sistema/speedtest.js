const TEST_HOST = "https://speed.cloudflare.com";
const TRACE_HOST = "https://1.1.1.1/cdn-cgi/trace";

const PING_SAMPLES = 3;
const DEFAULT_DOWNLOAD_BYTES = 16_000_000;
const DEFAULT_UPLOAD_BYTES = 4_000_000;

const REQUEST_TIMEOUT_MS = 45_000;
const TRACE_TIMEOUT_MS = 8_000;

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "es-419,es;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

const CF_HEADERS = {
  ...DEFAULT_HEADERS,
  origin: TEST_HOST,
  referer: `${TEST_HOST}/`,
};

const DOWNLOAD_FALLBACKS = [
  {
    name: "Cloudflare",
    buildUrl: (bytesWanted) =>
      `${TEST_HOST}/__down?bytes=${bytesWanted}&r=${Date.now()}`,
    headers: CF_HEADERS,
  },
  {
    name: "Hetzner",
    url: "https://speed.hetzner.de/100MB.bin",
    headers: DEFAULT_HEADERS,
    supportsRange: true,
  },
  {
    name: "OVH",
    url: "https://proof.ovh.net/files/100Mb.dat",
    headers: DEFAULT_HEADERS,
    supportsRange: true,
  },
  {
    name: "Cachefly",
    url: "https://cachefly.cachefly.net/100mb.test",
    headers: DEFAULT_HEADERS,
    supportsRange: true,
  },
];

const UPLOAD_FALLBACKS = [
  {
    name: "Cloudflare",
    buildUrl: () => `${TEST_HOST}/__up?r=${Date.now()}`,
    headers: CF_HEADERS,
  },
  {
    name: "Postman",
    url: "https://postman-echo.com/post",
    headers: DEFAULT_HEADERS,
  },
  {
    name: "Httpbin",
    url: "https://httpbin.org/post",
    headers: DEFAULT_HEADERS,
  },
];

let activeSpeedtest = null;

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, current) => sum + current, 0) / values.length;
}

function stdDev(values = []) {
  if (!values.length) return 0;
  const avg = average(values);
  const variance = average(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(0)} ms`;
}

function formatMbps(bytes, ms) {
  const totalMs = Math.max(1, Number(ms || 0));
  const mbps = ((Number(bytes || 0) * 8) / (totalMs / 1000)) / 1_000_000;
  return `${mbps.toFixed(2)} Mbps`;
}

function parseMbps(label = "") {
  const match = String(label).match(/([\d.]+)\s*Mbps/i);
  if (!match?.[1]) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function buildBar(percent, size = 16) {
  const pct = clampNumber(percent, 0, 100);
  const total = Math.max(8, Math.min(30, Number(size || 16)));
  const filled = Math.round((pct / 100) * total);
  return "█".repeat(filled) + "░".repeat(Math.max(0, total - filled));
}

async function readResponseBytes(response) {
  if (!response?.body?.getReader) {
    const payload = await response.arrayBuffer();
    return payload.byteLength;
  }

  const reader = response.body.getReader();
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength || 0;
  }

  return total;
}

async function readResponseBytesLimited(response, limitBytes) {
  const limit = Number(limitBytes || 0);
  if (!limit || limit <= 0) return readResponseBytes(response);

  if (!response?.body?.getReader) {
    const payload = await response.arrayBuffer();
    return Math.min(payload.byteLength, limit);
  }

  const reader = response.body.getReader();
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value?.byteLength || 0;

    if (total >= limit) {
      try {
        await reader.cancel();
      } catch {}
      break;
    }
  }

  return total;
}

async function runTimedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = process.hrtime.bigint();

  try {
    const headers = {
      ...DEFAULT_HEADERS,
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { response, startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function measurePing() {
  const samples = [];
  let useFallback = false;

  for (let index = 0; index < PING_SAMPLES; index += 1) {
    try {
      const url = `${TEST_HOST}/__down?bytes=1&r=${Date.now()}-${index}`;
      const { response, startedAt } = await runTimedFetch(
        url,
        { method: "GET", headers: CF_HEADERS }
      );

      await readResponseBytesLimited(response, 8192);

      const endedAt = process.hrtime.bigint();
      samples.push(Number(endedAt - startedAt) / 1_000_000);
    } catch {
      useFallback = true;
      break;
    }
  }

  if (useFallback) {
    samples.length = 0;

    for (let index = 0; index < PING_SAMPLES; index += 1) {
      const url = `${TRACE_HOST}?r=${Date.now()}-${index}`;
      const { response, startedAt } = await runTimedFetch(
        url,
        { method: "GET", headers: DEFAULT_HEADERS },
        TRACE_TIMEOUT_MS
      );

      await readResponseBytesLimited(response, 8192);

      const endedAt = process.hrtime.bigint();
      samples.push(Number(endedAt - startedAt) / 1_000_000);
    }
  }

  return {
    samples,
    averageMs: average(samples),
    bestMs: Math.min(...samples),
    jitterMs: stdDev(samples),
  };
}

async function measureDownload(bytesToDownload) {
  const bytesWanted = Math.max(1_000_000, Number(bytesToDownload || DEFAULT_DOWNLOAD_BYTES));
  let lastError = "No pude medir la descarga.";

  for (const provider of DOWNLOAD_FALLBACKS) {
    try {
      const url = provider.buildUrl ? provider.buildUrl(bytesWanted) : provider.url;
      const headers = { ...(provider.headers || {}) };

      if (provider.supportsRange) {
        headers.range = `bytes=0-${bytesWanted - 1}`;
      }

      const { response, startedAt } = await runTimedFetch(url, {
        method: "GET",
        headers,
      });

      const bytes = await readResponseBytesLimited(response, bytesWanted);
      const endedAt = process.hrtime.bigint();
      const elapsedMs = Number(endedAt - startedAt) / 1_000_000;

      return {
        ok: true,
        provider: provider.name,
        bytes,
        elapsedMs,
        speedLabel: formatMbps(bytes, elapsedMs),
      };
    } catch (error) {
      lastError = `${provider.name}: ${error?.message || error}`;
    }
  }

  return {
    ok: false,
    provider: "",
    bytes: 0,
    elapsedMs: 0,
    speedLabel: "0.00 Mbps",
    error: lastError,
  };
}

async function measureUpload(bytesToUpload) {
  const bytesWanted = Math.max(500_000, Number(bytesToUpload || DEFAULT_UPLOAD_BYTES));
  const payloadSize = clampNumber(bytesWanted, 500_000, 4_000_000);
  const payload = Buffer.alloc(payloadSize, 97);
  let lastError = "No pude medir la subida.";

  for (const provider of UPLOAD_FALLBACKS) {
    try {
      const url = provider.buildUrl ? provider.buildUrl() : provider.url;
      const headers = {
        ...(provider.headers || {}),
        "content-type": "application/octet-stream",
        "content-length": String(payload.length),
      };

      const { response, startedAt } = await runTimedFetch(url, {
        method: "POST",
        headers,
        body: payload,
      });

      await response.text();

      const endedAt = process.hrtime.bigint();
      const elapsedMs = Number(endedAt - startedAt) / 1_000_000;

      return {
        ok: true,
        provider: provider.name,
        bytes: payload.length,
        elapsedMs,
        speedLabel: formatMbps(payload.length, elapsedMs),
      };
    } catch (error) {
      lastError = `${provider.name}: ${error?.message || error}`;
    }
  }

  return {
    ok: false,
    provider: "",
    bytes: payload.length,
    elapsedMs: 0,
    speedLabel: "0.00 Mbps",
    error: lastError,
  };
}

async function executeSpeedtest(options = {}) {
  const startedAt = Date.now();
  const downloadBytes = Number(options.downloadBytes || DEFAULT_DOWNLOAD_BYTES);
  const uploadBytes = Number(options.uploadBytes || DEFAULT_UPLOAD_BYTES);

  const ping = await measurePing();
  const download = await measureDownload(downloadBytes);
  const upload = await measureUpload(uploadBytes);

  return {
    startedAt,
    finishedAt: Date.now(),
    ping,
    download,
    upload,
  };
}

function buildOwnerContact(settings = {}) {
  return String(settings.ownerName || "DVYER").trim();
}

function buildResultMessage(result, modeLabel = "NORMAL", contactText = "") {
  const totalTimeMs =
    Math.max(0, Number(result?.finishedAt || 0) - Number(result?.startedAt || 0));

  const dl = parseMbps(result?.download?.speedLabel);
  const ul = parseMbps(result?.upload?.speedLabel);
  const ping = Number(result?.ping?.averageMs || 0);
  const jitter = Number(result?.ping?.jitterMs || 0);

  const dlPct = clampNumber((dl / 300) * 100, 0, 100);
  const ulPct = clampNumber((ul / 150) * 100, 0, 100);

  const lines = [
    "⚡ *SPEEDTEST COMPLETADO*",
    "",
    `🧪 Modo: *${modeLabel}*`,
    `📥 Descarga: *${result?.download?.speedLabel || "0.00 Mbps"}*`,
    `${buildBar(dlPct)} ${dlPct.toFixed(0)}%`,
    "",
    `📤 Subida: *${result?.upload?.speedLabel || "0.00 Mbps"}*`,
    `${buildBar(ulPct)} ${ulPct.toFixed(0)}%`,
    "",
    `📶 Ping: *${formatMs(ping)}*`,
    `〰️ Jitter: *${formatMs(jitter)}*`,
    "",
    `🌐 Proveedores: DL ${result?.download?.provider || "?"} | UL ${result?.upload?.provider || "?"}`,
    `⏱️ Duración total: *${formatMs(totalTimeMs)}*`,
    `📊 Muestras de ping: *${PING_SAMPLES}*`,
  ];

  if (contactText) {
    lines.push(`👤 Owner: *${contactText}*`);
  }

  if (result?.download?.ok === false) {
    lines.push(`⚠️ Error descarga: ${result.download.error || "desconocido"}`);
  }

  if (result?.upload?.ok === false) {
    lines.push(`⚠️ Error subida: ${result.upload.error || "desconocido"}`);
  }

  return lines.join("\n");
}

function buildErrorMessage(error, contactText = "") {
  const message = String(error?.message || error || "Error desconocido");
  const lines = [
    "❌ *Speedtest no se completó*",
    `Motivo: ${message}`,
  ];

  if (contactText) {
    lines.push(`👤 Owner: *${contactText}*`);
  }

  return lines.join("\n");
}

function resolveMode(args = []) {
  const mode = String(args?.[0] || "").trim().toLowerCase();

  if (["full", "pro", "completo"].includes(mode)) {
    return {
      modeLabel: "COMPLETO",
      downloadBytes: 40_000_000,
      uploadBytes: 12_000_000,
    };
  }

  if (["lite", "rapido", "fast"].includes(mode)) {
    return {
      modeLabel: "RAPIDO",
      downloadBytes: 8_000_000,
      uploadBytes: 2_000_000,
    };
  }

  return {
    modeLabel: "NORMAL",
    downloadBytes: DEFAULT_DOWNLOAD_BYTES,
    uploadBytes: DEFAULT_UPLOAD_BYTES,
  };
}

export default {
  name: "speedtest",
  command: ["speedtest"],
  category: "sistema",
  description: "Mide ping, descarga y subida del internet del bot",

  run: async ({ sock, msg, from, args = [], settings = {} }) => {
    if (activeSpeedtest) {
      return sock.sendMessage(
        from,
        {
          text: "⏳ Ya hay un speedtest en progreso. Espera a que termine.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const { modeLabel, downloadBytes, uploadBytes } = resolveMode(args);
    const ownerName = buildOwnerContact(settings);

    await sock.sendMessage(
      from,
      {
        text: `⚡ Iniciando speedtest *${modeLabel}*...\n👤 Owner: *${ownerName}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );

    activeSpeedtest = executeSpeedtest({ downloadBytes, uploadBytes });

    try {
      const result = await activeSpeedtest;

      return sock.sendMessage(
        from,
        {
          text: buildResultMessage(result, modeLabel, ownerName),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("SPEEDTEST ERROR:", error);

      return sock.sendMessage(
        from,
        {
          text: buildErrorMessage(error, ownerName),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } finally {
      activeSpeedtest = null;
    }
  },
};