import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Browser Toolbox",
    description: "A lightweight toolbox for quick page actions and developer helpers.",
    permissions: ["storage", "tabs", "contextMenus"],
    host_permissions: ["http://*/*", "https://*/*"],
    browser_specific_settings: {
      gecko: {
        id: "browser-toolbox@moka.local"
      }
    }
  }
});
