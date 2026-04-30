import React from "react";
import {
  Bolt,
  ExternalLink,
  Globe,
  Sparkles,
  Wrench
} from "lucide-react";
import { browser } from "wxt/browser";

import { SwitchRow } from "@/components/ui/switch";
import { getGlobalConfig, getHostConfig, setGlobalConfig, setHostConfig, type HostConfig, type GlobalConfig } from "@/shared/storage";
import { READY_TOOLS, findToolById } from "@/shared/tools";

type PopupState = {
  loading: boolean;
  hostname?: string;
  tabId?: number;
  canControlHost: boolean;
  globalConfig: GlobalConfig;
  hostConfig: HostConfig;
};

const INITIAL_STATE: PopupState = {
  loading: true,
  canControlHost: false,
  globalConfig: {
    enabled: true,
    recentTools: [],
    theme: "system"
  },
  hostConfig: {
    mode: "bubble",
    bubblePosition: { x: 24, y: 120 }
  }
};

export function PopupApp() {
  const [state, setState] = React.useState<PopupState>(INITIAL_STATE);

  const sync = React.useCallback(async () => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const url = activeTab?.url;
    const canControlHost = Boolean(url && /^https?:\/\//.test(url));
    const hostname = canControlHost ? new URL(url!).hostname : undefined;

    const [globalConfig, hostConfig] = await Promise.all([
      getGlobalConfig(),
      hostname ? getHostConfig(hostname) : Promise.resolve(INITIAL_STATE.hostConfig)
    ]);

    setState({
      loading: false,
      hostname,
      tabId: activeTab?.id,
      canControlHost,
      globalConfig,
      hostConfig
    });
  }, []);

  React.useEffect(() => {
    void sync();
  }, [sync]);

  const toggleGlobal = async (checked: boolean) => {
    const nextGlobal = { ...state.globalConfig, enabled: checked };
    await setGlobalConfig(nextGlobal);
    setState((current) => ({ ...current, globalConfig: nextGlobal }));
  };

  const toggleHost = async (checked: boolean) => {
    if (!state.hostname) {
      return;
    }

    const nextHost = {
      ...state.hostConfig,
      mode: checked ? "bubble" : "off"
    } satisfies HostConfig;

    await setHostConfig(state.hostname, nextHost);
    setState((current) => ({ ...current, hostConfig: nextHost }));
  };

  const openToolbox = async (toolId?: string) => {
    await browser.runtime.sendMessage({
      type: "open-toolbox",
      sourceTabId: state.tabId,
      sourceHost: state.hostname,
      toolId
    });
    window.close();
  };

  return (
    <main className="popup-shell">
      <section className="hero-card compact">
        <div className="hero-row">
          <div className="hero-icon">
            <Wrench size={18} />
          </div>
          <div>
            <h1>Browser Toolbox</h1>
            <p>Popup 负责控制，小球负责进入完整工具页。</p>
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-title">
          <Sparkles size={16} />
          <span>开关</span>
        </div>
        <div className="stack">
          <SwitchRow
            checked={state.globalConfig.enabled}
            label="全局启用"
            hint="关闭后所有站点都不会显示小球。"
            onCheckedChange={toggleGlobal}
            icon={<Bolt size={15} />}
          />
          <SwitchRow
            checked={state.hostConfig.mode === "bubble"}
            disabled={!state.canControlHost || !state.globalConfig.enabled}
            label={state.hostname ? `${state.hostname}` : "当前页面不可控制"}
            hint={state.canControlHost ? "按 hostname 记忆小球状态。" : "仅支持 http/https 页面。"}
            onCheckedChange={toggleHost}
            icon={<Globe size={15} />}
          />
        </div>
      </section>

      <section className="panel-card">
        <div className="section-title">
          <ExternalLink size={16} />
          <span>快速进入</span>
        </div>
        <div className="button-grid">
          <button className="primary-button" onClick={() => openToolbox()}>
            打开工具页
          </button>
          {READY_TOOLS.slice(0, 3).map((tool) => (
            <button
              key={tool.id}
              className="ghost-button"
              onClick={() => openToolbox(tool.id)}
            >
              {tool.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="section-title">
          <Bolt size={16} />
          <span>最近使用</span>
        </div>
        <div className="recent-list">
          {state.globalConfig.recentTools.length === 0 ? (
            <p className="empty-state">还没有最近使用记录。</p>
          ) : (
            state.globalConfig.recentTools
              .map(findToolById)
              .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
              .map((tool) => (
                <button
                  key={tool.id}
                  className="recent-item"
                  onClick={() => openToolbox(tool.id)}
                >
                  <span>{tool.name}</span>
                  <span>{tool.description}</span>
                </button>
              ))
          )}
        </div>
      </section>
    </main>
  );
}

