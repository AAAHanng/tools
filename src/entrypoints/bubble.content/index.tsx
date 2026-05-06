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
  type GlobalConfig,
  type UrlParamShortcut
} from "@/shared/storage";
import {
  getUrlParamShortcuts,
  getGlobalConfig,
  getHostConfig,
  setHostConfig
} from "@/shared/storage";
import { normalizeHotkeyFromKeyboardEvent } from "@/shared/hotkeys";

type BubbleState = {
  globalConfig: GlobalConfig;
  hostConfig: HostConfig;
  urlParamShortcuts: UrlParamShortcut[];
};

const BUBBLE_SIZE = 52;
const BUBBLE_MARGIN = 12;
const DRAG_THRESHOLD = 4;

function BubbleApp() {
  const [state, setState] = React.useState<BubbleState>({
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    hostConfig: DEFAULT_HOST_CONFIG,
    urlParamShortcuts: []
  });
  const hostname = window.location.hostname;
  const positionRef = React.useRef(DEFAULT_HOST_CONFIG.bubblePosition);
  const suppressNextClickRef = React.useRef(false);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const [globalConfig, hostConfig] = await Promise.all([
        getGlobalConfig(),
        getHostConfig(hostname)
      ]);
      const urlParamShortcuts = await getUrlParamShortcuts();

      if (mounted) {
        setState({ globalConfig, hostConfig, urlParamShortcuts });
        positionRef.current = hostConfig.bubblePosition;
      }
    };

    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.globalConfig || changes.hostConfigs || changes.urlParamShortcuts) {
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

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!state.globalConfig.enabled) {
        return;
      }

      const hotkey = normalizeHotkeyFromKeyboardEvent(event);

      if (!hotkey) {
        return;
      }

      const shortcut = state.urlParamShortcuts.find(
        (item) => item.hotkey === hotkey && item.key.trim()
      );

      if (!shortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void browser.runtime.sendMessage({
        type: "apply-url-param-shortcut",
        key: shortcut.key,
        value: shortcut.value
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [state.globalConfig.enabled, state.urlParamShortcuts]);

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
      originY: rect.top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    const nextX = Math.max(
      BUBBLE_MARGIN,
      Math.min(
        window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN,
        dragRef.current.originX + deltaX
      )
    );
    const nextY = Math.max(
      BUBBLE_MARGIN,
      Math.min(
        window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN,
        dragRef.current.originY + deltaY
      )
    );
    const nextPosition = { x: nextX, y: nextY };

    if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      dragRef.current.moved = true;
    }

    positionRef.current = nextPosition;

    setState((current) => ({
      ...current,
      hostConfig: {
        ...current.hostConfig,
        bubblePosition: nextPosition
      }
    }));
  };

  const onPointerUp = async (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (!dragState.moved) {
      return;
    }

    suppressNextClickRef.current = true;
    await setHostConfig(hostname, {
      ...state.hostConfig,
      bubblePosition: positionRef.current
    });
  };

  const openToolbox = async () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    await browser.runtime.sendMessage({
      type: "open-toolbox",
      sourceHost: hostname
    });
  };

  return (
    <button
      className="bubble-root"
      style={positionStyle}
      title="一键打开工具箱"
      aria-label="一键打开工具箱"
      onClick={openToolbox}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Wrench size={20} strokeWidth={2.2} />
      <span>打开</span>
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
