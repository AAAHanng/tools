# Browser Toolbox Extension

一个面向 Chrome / Firefox 的浏览器工具箱骨架，当前包含：

- 页面内悬浮小球
- Popup 双入口
- 独立 Toolbox Page
- `hostname` 级别开关和位置记忆
- 3 个可用工具：URL 参数、JSON 格式化、JSON 对比

## 安装

Node 要求：`>= 22.12.0`

如果你的默认 Node 不是 22，先切换：

```bash
nvm use 22
```

或者直接用本机路径：

```bash
/Users/moka/.nvm/versions/node/v22.17.1/bin/npm install
```

然后安装依赖：

```bash
npm install
```

## 本地开发

Chrome:

```bash
nvm use 22
npm run dev
```

Firefox:

```bash
nvm use 22
npm run dev:firefox
```

WXT 会自动启动一个开发浏览器并加载扩展。官方说明见：

- [WXT Installation](https://wxt.dev/guide/installation)
- [WXT Browser Startup](https://wxt.dev/guide/essentials/config/browser-startup)
- [WXT Target Different Browsers](https://wxt.dev/guide/essentials/target-different-browsers.html)

## 手动加载调试

Chrome:

1. 运行 `npm run build`
2. 打开 `chrome://extensions`
3. 开启开发者模式
4. 选择“加载已解压的扩展程序”
5. 选择 `.output/chrome-mv3`

Firefox:

1. 运行 `npm run build:firefox`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击“临时载入附加组件”
4. 选择 `.output/firefox-mv2/manifest.json`

## 调试入口

- Popup：点浏览器工具栏里的扩展图标，然后给 popup 开发者工具
- Content script：打开网页开发者工具，在页面 Console 看日志
- Background：
  - Chrome：`chrome://extensions` -> 当前扩展 -> `service worker`
  - Firefox：`about:debugging` -> 当前扩展 -> `Inspect`
- Toolbox Page：它本质是扩展页，直接对该标签页开 DevTools 即可

## 推荐调试流程

1. 执行 `nvm use 22`
2. 执行 `npm install`
3. Chrome 开发时执行 `npm run dev`
4. Firefox 开发时执行 `npm run dev:firefox`
5. 改动 `content/popup/toolbox` 后，WXT 会热更新或自动重载扩展
6. 如果热更新没有生效，手动刷新当前网页或重新点开扩展页

## 持久化 Chrome 开发资料

如果你希望开发时保留登录状态，可以新增 `web-ext.config.ts`：

```ts
import { defineWebExtConfig } from "wxt";

export default defineWebExtConfig({
  chromiumArgs: ["--user-data-dir=./.wxt/chrome-data"]
});
```

## 当前架构

```text
src/
  entrypoints/
    background.ts
    bubble.content/
      index.tsx
      style.css
    popup/
      index.html
      main.tsx
    toolbox/
      index.html
      main.tsx
  components/
  features/
  shared/
```

## 当前限制

- `off` 模式当前是不显示 UI，但 content script 仍会注入到 `http/https` 页面
- 复杂工具如 HTTP/WebSocket/性能分析仍保留在下一阶段
