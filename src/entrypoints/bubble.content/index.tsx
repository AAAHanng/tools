import "./style.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { Wrench } from "lucide-react";
import { browser } from "wxt/browser";
import { createShadowRootUi, defineContentScript } from "#imports";

import {
  DEFAULT_HOST_CONFIG,
  DEFAULT_GLOBAL_CONFIG,
  type HostConfig,
  type GlobalConfig
} from "@/shared/storage";
import {
  getGlobalConfig,
  getHostConfig,
  setHostConfig
} from "@/shared/storage";

type BubbleState = {
  globalConfig: GlobalConfig;
  hostConfig: HostConfig;
};

function BubbleApp() {
  const [state, setState] = React.useState<BubbleState>({
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    hostConfig: DEFAULT_HOST_CONFIG
  });
  const hostname = window.location.hostname;
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const [globalConfig, hostConfig] = await Promise.all([
        getGlobalConfig(),
        getHostConfig(hostname)
      ]);

      if (mounted) {
        setState({ globalConfig, hostConfig });
      }
    };

    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.globalConfig || changes.hostConfigs) {
        void sync();
      }
    };

    void sync();
    browser.storage.onChanged.addListener(onChanged);

    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [hostname]);

  if (!state.globalConfig.enabled || state.hostConfig.mode === "off") {
    return null;
  }

  const positionStyle = {
    left: `${state.hostConfig.bubblePosition.x}px`,
    top: `${state.hostConfig.bubblePosition.y}px`
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const nextX = Math.max(12, Math.min(window.innerWidth - 64, dragRef.current.originX + event.clientX - dragRef.current.startX));
    const nextY = Math.max(12, Math.min(window.innerHeight - 64, dragRef.current.originY + event.clientY - dragRef.current.startY));

    setState((current) => ({
      ...current,
      hostConfig: {
        ...current.hostConfig,
        bubblePosition: { x: nextX, y: nextY }
      }
    }));
  };

  const onPointerUp = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    await setHostConfig(hostname, state.hostConfig);
  };

  const openToolbox = async () => {
    await browser.runtime.sendMessage({
      type: "open-toolbox",
      sourceTabId: undefined,
      sourceHost: hostname
    });
  };

  return (
    <button
      className="bubble-root"
      style={positionStyle}
      title="Open Browser Toolbox"
      onClick={openToolbox}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Wrench size={20} strokeWidth={2.2} />
    </button>
  );
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "browser-toolbox-bubble",
      position: "inline",
      anchor: "body",
      onMount(container) {
        const root = createRoot(container);
        root.render(<BubbleApp />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      }
    });

    ui.mount();
  }
});
