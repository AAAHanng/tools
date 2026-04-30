import { browser } from "wxt/browser";

import { TOOLBOX_ROUTE } from "@/shared/constants";

type OpenToolboxOptions = {
  sourceTabId?: number;
  sourceHost?: string;
  toolId?: string;
};

export async function getActiveTabContext() {
  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  const url = activeTab?.url;

  return {
    tabId: activeTab?.id,
    url,
    hostname: url && /^https?:\/\//.test(url) ? new URL(url).hostname : undefined
  };
}

export async function openOrFocusToolboxPage(options: OpenToolboxOptions = {}) {
  const params = new URLSearchParams();

  if (options.sourceTabId != null) {
    params.set("sourceTabId", String(options.sourceTabId));
  }
  if (options.sourceHost) {
    params.set("sourceHost", options.sourceHost);
  }
  if (options.toolId) {
    params.set("tool", options.toolId);
  }

  const toolboxUrl = browser.runtime.getURL(`${TOOLBOX_ROUTE}${params.toString() ? `?${params.toString()}` : ""}`);
  const tabs = await browser.tabs.query({ url: `${browser.runtime.getURL(TOOLBOX_ROUTE)}*` });
  const existing = tabs[0];

  if (existing?.id) {
    await browser.tabs.update(existing.id, { active: true, url: toolboxUrl });
    if (typeof existing.windowId === "number") {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: toolboxUrl });
}

export async function updateTabUrlParameter(tabId: number, key: string, value: string) {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    return {
      ok: false,
      error: "目标标签页不是可编辑的 http/https 页面。"
    };
  }

  const nextUrl = new URL(tab.url);
  nextUrl.searchParams.set(key, value);
  await browser.tabs.update(tabId, { url: nextUrl.toString() });

  return {
    ok: true,
    url: nextUrl.toString()
  };
}

