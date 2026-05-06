import React from "react";
import { browser } from "wxt/browser";
import { Keyboard, Trash2, X } from "lucide-react";

import {
  getUrlParamShortcuts,
  setUrlParamShortcuts,
  type UrlParamShortcut
} from "@/shared/storage";
import { normalizeHotkeyFromKeyboardEvent } from "@/shared/hotkeys";

type UrlParamsToolProps = {
  sourceTabId?: number;
  sourceHost?: string;
};

const MAX_SHORTCUTS = 9;

export function UrlParamsTool(props: UrlParamsToolProps) {
  const { sourceTabId, sourceHost } = props;
  const [key, setKey] = React.useState("EXTENSION_DEBUG");
  const [value, setValue] = React.useState("true");
  const [shortcuts, setShortcuts] = React.useState<UrlParamShortcut[]>([]);
  const [recordingShortcutId, setRecordingShortcutId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    void getUrlParamShortcuts().then((items) => {
      setShortcuts(items.slice(0, MAX_SHORTCUTS));
    });
  }, []);

  const saveShortcuts = React.useCallback((nextShortcuts: UrlParamShortcut[]) => {
    const normalized = nextShortcuts.slice(0, MAX_SHORTCUTS);
    setShortcuts(normalized);
    void setUrlParamShortcuts(normalized);
  }, []);

  const fillShortcut = React.useCallback((shortcut: UrlParamShortcut) => {
    setKey(shortcut.key);
    setValue(shortcut.value);
    setMessage(`已录入快捷项：${shortcut.name}`);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (recordingShortcutId) {
        event.preventDefault();
        event.stopPropagation();

        if (event.key === "Escape") {
          setRecordingShortcutId(null);
          setMessage("已取消快捷键录入。");
          return;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          saveShortcuts(
            shortcuts.map((shortcut) =>
              shortcut.id === recordingShortcutId
                ? { ...shortcut, hotkey: undefined, updatedAt: Date.now() }
                : shortcut
            )
          );
          setRecordingShortcutId(null);
          setMessage("已清除快捷键。");
          return;
        }

        const hotkey = normalizeHotkeyFromKeyboardEvent(event);

        if (!hotkey) {
          setMessage("请按下包含 Ctrl / Alt / Meta 的组合键。");
          return;
        }

        saveShortcuts(
          shortcuts.map((shortcut) =>
            shortcut.id === recordingShortcutId
              ? { ...shortcut, hotkey, updatedAt: Date.now() }
              : shortcut.hotkey === hotkey
                ? { ...shortcut, hotkey: undefined, updatedAt: Date.now() }
                : shortcut
          )
        );
        setRecordingShortcutId(null);
        setMessage(`已录入快捷键：${hotkey}`);
        return;
      }

      const hotkey = normalizeHotkeyFromKeyboardEvent(event);

      if (!hotkey) {
        return;
      }

      const matchedShortcut = shortcuts.find((shortcut) => shortcut.hotkey === hotkey);

      if (!matchedShortcut) {
        return;
      }

      event.preventDefault();
      fillShortcut(matchedShortcut);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fillShortcut, recordingShortcutId, saveShortcuts, shortcuts]);

  const saveCurrentAsShortcut = () => {
    const nextKey = key.trim();

    if (!nextKey) {
      setMessage("Key 不能为空。");
      return;
    }

    const nextShortcut: UrlParamShortcut = {
      id: crypto.randomUUID(),
      name: `${nextKey}=${value}`,
      key: nextKey,
      value,
      hotkey: undefined,
      updatedAt: Date.now()
    };
    const deduped = shortcuts.filter(
      (shortcut) => shortcut.key !== nextShortcut.key || shortcut.value !== nextShortcut.value
    );

    saveShortcuts([nextShortcut, ...deduped]);
    setMessage(`已保存快捷项：${nextShortcut.name}`);
  };

  const removeShortcut = (shortcutId: string) => {
    saveShortcuts(shortcuts.filter((shortcut) => shortcut.id !== shortcutId));
    setMessage("已删除快捷项。");
  };

  const apply = async () => {
    const nextKey = key.trim();

    if (!nextKey) {
      setMessage("Key 不能为空。");
      return;
    }

    if (!sourceTabId) {
      setMessage("当前没有可用的页面上下文，请从 popup 或网页小球进入。");
      return;
    }

    const result = await browser.runtime.sendMessage({
      type: "update-active-tab-url-param",
      tabId: sourceTabId,
      key: nextKey,
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
        <button className="ghost-button" onClick={saveCurrentAsShortcut}>
          保存为快捷录入
        </button>
      </div>

      <section className="shortcut-panel">
        <div className="shortcut-panel-head">
          <strong>快捷录入</strong>
          <span>点击录入后按组合键</span>
        </div>
        <div className="shortcut-grid">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.id} className="shortcut-item">
              <button
                className="shortcut-fill"
                onClick={() => fillShortcut(shortcut)}
                type="button"
              >
                <kbd>{shortcut.hotkey ?? "--"}</kbd>
                <span>
                  <strong>{shortcut.name}</strong>
                  <small>{shortcut.key}={shortcut.value}</small>
                </span>
              </button>
              <button
                className="shortcut-record"
                onClick={() => {
                  setRecordingShortcutId(shortcut.id);
                  setMessage(`正在录入 ${shortcut.name} 的快捷键。`);
                }}
                type="button"
                title="录入快捷键"
              >
                {recordingShortcutId === shortcut.id ? <X size={14} /> : <Keyboard size={14} />}
              </button>
              <button
                className="shortcut-delete"
                onClick={() => removeShortcut(shortcut.id)}
                type="button"
                title="删除快捷项"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {message ? <div className="info-box">{message}</div> : null}
    </div>
  );
}
