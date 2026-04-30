import { defineBackground } from "#imports";
import { browser } from "wxt/browser";

import { TOOLBOX_ROUTE } from "@/shared/constants";
import {
  getActiveTabContext,
  openOrFocusToolboxPage,
  updateTabUrlParameter
} from "@/shared/runtime";

type OpenToolboxMessage = {
  type: "open-toolbox";
  sourceTabId?: number;
  sourceHost?: string;
  toolId?: string;
};

type UpdateUrlParamMessage = {
  type: "update-active-tab-url-param";
  tabId: number;
  key: string;
  value: string;
};

type RuntimeContextMessage = {
  type: "get-active-tab-context";
};

export default defineBackground({
  type: "module",
  main() {
    browser.runtime.onInstalled.addListener(() => {
      void openOrFocusToolboxPage();
    });

    browser.runtime.onMessage.addListener((message: OpenToolboxMessage | UpdateUrlParamMessage | RuntimeContextMessage) => {
      if (message.type === "open-toolbox") {
        void openOrFocusToolboxPage({
          sourceTabId: message.sourceTabId,
          sourceHost: message.sourceHost,
          toolId: message.toolId
        });
        return;
      }

      if (message.type === "update-active-tab-url-param") {
        return updateTabUrlParameter(message.tabId, message.key, message.value);
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
