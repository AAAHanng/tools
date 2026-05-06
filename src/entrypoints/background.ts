import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";

import {
  getActiveTabContext,
  openOrFocusToolboxPage,
  updateTabUrlParameter
} from "@/shared/runtime";
import { setPendingJsonInput } from "@/shared/storage";

type OpenToolboxMessage = {
  type: "open-toolbox";
  sourceTabId?: number;
  sourceHost?: string;
  toolId?: string;
  inputId?: string;
};

type UpdateUrlParamMessage = {
  type: "update-active-tab-url-param";
  tabId: number;
  key: string;
  value: string;
};

type ApplyUrlParamShortcutMessage = {
  type: "apply-url-param-shortcut";
  key: string;
  value: string;
};

type RuntimeContextMessage = {
  type: "get-active-tab-context";
};

const OPEN_SELECTION_AS_JSON_MENU_ID = "open-selection-as-json";

type MenuClickInfo = Browser.contextMenus.OnClickData;
type MenuTab = Browser.tabs.Tab;

function getHostname(url?: string) {
  if (!url || !/^https?:\/\//.test(url)) {
    return undefined;
  }

  return new URL(url).hostname;
}

export default defineBackground({
  type: "module",
  main() {
    const registerContextMenus = () => {
      browser.contextMenus
        .remove(OPEN_SELECTION_AS_JSON_MENU_ID)
        .catch(() => undefined)
        .finally(() => {
          browser.contextMenus.create({
            id: OPEN_SELECTION_AS_JSON_MENU_ID,
            title: "用 JSON 美化工具打开选中内容",
            contexts: ["selection"]
          });
        });
    };

    browser.runtime.onInstalled.addListener(() => {
      registerContextMenus();
      void openOrFocusToolboxPage();
    });

    browser.runtime.onStartup.addListener(() => {
      registerContextMenus();
    });

    browser.contextMenus.onClicked.addListener(
      (info: MenuClickInfo, tab?: MenuTab) => {
        if (
          info.menuItemId !== OPEN_SELECTION_AS_JSON_MENU_ID ||
          !info.selectionText?.trim()
        ) {
          return;
        }

        const inputId = crypto.randomUUID();
        const sourceHost = getHostname(info.pageUrl ?? tab?.url);

        void setPendingJsonInput({
          id: inputId,
          content: info.selectionText,
          sourceUrl: info.pageUrl ?? tab?.url,
          sourceHost,
          createdAt: Date.now()
        }).then(() =>
          openOrFocusToolboxPage({
            sourceTabId: tab?.id,
            sourceHost,
            toolId: "json-format",
            inputId
          })
        );
      }
    );

    browser.runtime.onMessage.addListener((message: OpenToolboxMessage | UpdateUrlParamMessage | ApplyUrlParamShortcutMessage | RuntimeContextMessage, sender) => {
      if (message.type === "open-toolbox") {
        void openOrFocusToolboxPage({
          sourceTabId: message.sourceTabId ?? sender.tab?.id,
          sourceHost: message.sourceHost ?? getHostname(sender.tab?.url),
          toolId: message.toolId,
          inputId: message.inputId
        });
        return;
      }

      if (message.type === "update-active-tab-url-param") {
        return updateTabUrlParameter(message.tabId, message.key, message.value);
      }

      if (message.type === "apply-url-param-shortcut") {
        if (sender.tab?.id == null) {
          return {
            ok: false,
            error: "当前没有可用的页面上下文。"
          };
        }

        return updateTabUrlParameter(sender.tab.id, message.key, message.value);
      }

      if (message.type === "get-active-tab-context") {
        return getActiveTabContext();
      }
    });

    browser.commands?.onCommand.addListener((command) => {
      if (command === "open-toolbox") {
        void openOrFocusToolboxPage();
      }
    });

    browser.action.setBadgeBackgroundColor({ color: "#111827" }).catch(() => undefined);
    browser.action.setBadgeText({ text: "" }).catch(() => undefined);
  }
});
