import path from "path";
import { createScheduledJsonStore } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "api-providers.json");

function buildDefaultState() {
  return {
    providers: {
      dvyer: {
        enabled: true,
        baseUrl: "https://dv-yer-api.online",
      },
      ai: {
        enabled: true,
        gpt5Url: "https://api.soymaycol.icu/api/ai/gpt5",
      },
      mediafire: {
        enabled: true,
        url: "https://api-adonix.ultraplus.click/download/mediafire",
        apiKey: String(process.env.MEDIAFIRE_API_KEY || "").trim(),
      },
      tikwm: {
        enabled: true,
        searchUrl: "https://www.tikwm.com/api/feed/search",
      },
      bing: {
        enabled: true,
        imageSearchUrl: "https://www.bing.com/images/search",
      },
    },
  };
}

const store = createScheduledJsonStore(FILE, buildDefaultState);

function ensureProvider(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;

  if (!store.state.providers[key]) {
    store.state.providers[key] = {
      enabled: true,
    };
  }

  return store.state.providers[key];
}

export function listProviders() {
  return Object.entries(store.state.providers || {}).map(([name, config]) => ({
    name,
    ...config,
  }));
}

export function getProvider(name) {
  const provider = ensureProvider(name);
  return provider ? { name: String(name || "").trim().toLowerCase(), ...provider } : null;
}

export function setProviderValue(name, field, value) {
  const provider = ensureProvider(name);
  if (!provider) return null;
  provider[field] = value;
  store.scheduleSave();
  return { name: String(name || "").trim().toLowerCase(), ...provider };
}

export function setProviderEnabled(name, enabled) {
  return setProviderValue(name, "enabled", Boolean(enabled));
}

export function getDvyerBaseUrl() {
  const provider = ensureProvider("dvyer");
  return String(provider?.baseUrl || "https://dv-yer-api.online").trim().replace(/\/+$/, "");
}

export function buildDvyerUrl(endpoint = "") {
  const base = getDvyerBaseUrl();
  const suffix = String(endpoint || "").trim();
  if (!suffix) return base;
  if (/^https?:\/\//i.test(suffix)) return suffix;
  if (suffix.startsWith("/")) return `${base}${suffix}`;
  return `${base}/${suffix}`;
}

export function getGpt5Url(prompt = "") {
  const provider = ensureProvider("ai");
  const base = String(provider?.gpt5Url || "").trim();
  if (!base) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}prompt=${encodeURIComponent(prompt)}`;
}

export function getMediafireConfig() {
  const provider = ensureProvider("mediafire");
  return {
    enabled: provider?.enabled !== false,
    url: String(provider?.url || "").trim(),
    apiKey: String(provider?.apiKey || "").trim(),
  };
}

export function getApiChecks() {
  return [
    {
      name: "DVYER ytsearch",
      url: `${buildDvyerUrl("/ytsearch")}?q=ozuna&limit=1`,
    },
    {
      name: "DVYER ytdlmp3",
      url: buildDvyerUrl("/ytdlmp3"),
    },
    {
      name: "DVYER ytdlmp4",
      url: buildDvyerUrl("/ytdlmp4"),
    },
    {
      name: "DVYER tiktok",
      url: buildDvyerUrl("/ttdlmp4"),
    },
    {
      name: "DVYER spotify",
      url: buildDvyerUrl("/spotify"),
    },
    {
      name: "DVYER instagram",
      url: buildDvyerUrl("/instagram"),
    },
    {
      name: "DVYER apksearch",
      url: `${buildDvyerUrl("/apksearch")}?q=whatsapp&limit=1`,
    },
    {
      name: "TikTok Search Fallback",
      url: "https://www.tikwm.com/api/feed/search?keywords=ozuna&count=1&cursor=0&web=1",
    },
    {
      name: "Pinterest Fallback",
      url: "https://www.bing.com/images/search?q=cat",
    },
    {
      name: "IA GPT",
      url: getGpt5Url("hola"),
    },
  ];
}
