import { browser } from "wxt/browser";

export type HostMode = "off" | "bubble";

export type HostConfig = {
  mode: HostMode;
  bubblePosition: { x: number; y: number };
};

export type GlobalConfig = {
  enabled: boolean;
  recentTools: string[];
  theme: "system" | "light" | "dark";
};

export type JsonHistoryEntry = {
  id: string;
  content: string;
  updatedAt: number;
};

export type UrlParamShortcut = {
  id: string;
  name: string;
  key: string;
  value: string;
  hotkey?: string;
  updatedAt: number;
};

export type PendingJsonInput = {
  id: string;
  content: string;
  sourceUrl?: string;
  sourceHost?: string;
  createdAt: number;
};

type HostConfigMap = Record<string, HostConfig>;

const GLOBAL_CONFIG_KEY = "globalConfig";
const HOST_CONFIGS_KEY = "hostConfigs";
const JSON_HISTORY_KEY = "jsonFormatHistory";
const URL_PARAM_SHORTCUTS_KEY = "urlParamShortcuts";
const PENDING_JSON_INPUT_KEY = "pendingJsonFormatInput";

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  enabled: true,
  recentTools: [],
  theme: "system"
};

export const DEFAULT_HOST_CONFIG: HostConfig = {
  mode: "bubble",
  bubblePosition: { x: 24, y: 120 }
};

export const DEFAULT_URL_PARAM_SHORTCUTS: UrlParamShortcut[] = [
  {
    id: "extension-debug",
    name: "EXTENSION_DEBUG",
    key: "EXTENSION_DEBUG",
    value: "true",
    hotkey: "Alt+1",
    updatedAt: 0
  },
  {
    id: "debug-one",
    name: "debug=1",
    key: "debug",
    value: "1",
    hotkey: "Alt+2",
    updatedAt: 0
  }
];

export async function getGlobalConfig(): Promise<GlobalConfig> {
  const result = await browser.storage.local.get(GLOBAL_CONFIG_KEY);
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...(result[GLOBAL_CONFIG_KEY] as Partial<GlobalConfig> | undefined)
  };
}

export async function setGlobalConfig(config: GlobalConfig) {
  await browser.storage.local.set({
    [GLOBAL_CONFIG_KEY]: config
  });
}

export async function getHostConfigs(): Promise<HostConfigMap> {
  const result = await browser.storage.local.get(HOST_CONFIGS_KEY);
  return (result[HOST_CONFIGS_KEY] as HostConfigMap | undefined) ?? {};
}

export async function getHostConfig(hostname: string): Promise<HostConfig> {
  const configs = await getHostConfigs();
  return {
    ...DEFAULT_HOST_CONFIG,
    ...(configs[hostname] ?? {})
  };
}

export async function setHostConfig(hostname: string, config: HostConfig) {
  const configs = await getHostConfigs();
  configs[hostname] = config;

  await browser.storage.local.set({
    [HOST_CONFIGS_KEY]: configs
  });
}

export async function pushRecentTool(toolId: string): Promise<GlobalConfig> {
  const globalConfig = await getGlobalConfig();
  const recentTools = [toolId, ...globalConfig.recentTools.filter((id) => id !== toolId)].slice(0, 6);
  const nextGlobal = {
    ...globalConfig,
    recentTools
  };

  await setGlobalConfig(nextGlobal);
  return nextGlobal;
}

export async function getJsonHistory(): Promise<JsonHistoryEntry[]> {
  const result = await browser.storage.local.get(JSON_HISTORY_KEY);
  return (result[JSON_HISTORY_KEY] as JsonHistoryEntry[] | undefined) ?? [];
}

export async function setJsonHistory(entries: JsonHistoryEntry[]) {
  await browser.storage.local.set({
    [JSON_HISTORY_KEY]: entries
  });
}

export async function getUrlParamShortcuts(): Promise<UrlParamShortcut[]> {
  const result = await browser.storage.local.get(URL_PARAM_SHORTCUTS_KEY);
  const shortcuts = result[URL_PARAM_SHORTCUTS_KEY] as UrlParamShortcut[] | undefined;

  return Array.isArray(shortcuts) ? shortcuts : DEFAULT_URL_PARAM_SHORTCUTS;
}

export async function setUrlParamShortcuts(shortcuts: UrlParamShortcut[]) {
  await browser.storage.local.set({
    [URL_PARAM_SHORTCUTS_KEY]: shortcuts
  });
}

export async function setPendingJsonInput(input: PendingJsonInput) {
  await browser.storage.local.set({
    [PENDING_JSON_INPUT_KEY]: input
  });
}

export async function consumePendingJsonInput(id: string): Promise<PendingJsonInput | null> {
  const result = await browser.storage.local.get(PENDING_JSON_INPUT_KEY);
  const input = result[PENDING_JSON_INPUT_KEY] as PendingJsonInput | undefined;

  if (!input || input.id !== id) {
    return null;
  }

  await browser.storage.local.remove(PENDING_JSON_INPUT_KEY);
  return input;
}
