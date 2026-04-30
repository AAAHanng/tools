import React from "react";
import { browser } from "wxt/browser";

type UrlParamsToolProps = {
  sourceTabId?: number;
  sourceHost?: string;
};

export function UrlParamsTool(props: UrlParamsToolProps) {
  const { sourceTabId, sourceHost } = props;
  const [key, setKey] = React.useState("EXTENSION_DEBUG");
  const [value, setValue] = React.useState("true");
  const [message, setMessage] = React.useState("");

  const apply = async () => {
    if (!sourceTabId) {
      setMessage("当前没有可用的页面上下文，请从 popup 或网页小球进入。");
      return;
    }

    const result = await browser.runtime.sendMessage({
      type: "update-active-tab-url-param",
      tabId: sourceTabId,
      key,
      value
    });

    setMessage(result?.ok ? `已应用到 ${sourceHost ?? "当前页面"}` : result?.error ?? "更新失败");
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel-header">
        <div>
          <p className="eyebrow">Page</p>
          <h2>URL 参数工具</h2>
        </div>
        <button className="primary-button" onClick={apply}>应用到页面</button>
      </div>
      <p className="tool-description">把参数写回来源标签页的 URL。适合 `EXTENSION_DEBUG` 这类调试参数。</p>

      <div className="form-grid">
        <label className="field">
          <span>Key</span>
          <input value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label className="field">
          <span>Value</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
      </div>

      <div className="button-row">
        <button className="ghost-button" onClick={() => { setKey("EXTENSION_DEBUG"); setValue("true"); }}>
          模板: EXTENSION_DEBUG
        </button>
        <button className="ghost-button" onClick={() => { setKey("debug"); setValue("1"); }}>
          模板: debug=1
        </button>
      </div>

      {message ? <div className="info-box">{message}</div> : null}
    </div>
  );
}

