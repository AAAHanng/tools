import * as Tabs from "@radix-ui/react-tabs";
import clsx from "clsx";
import React from "react";
import { CodeXml, FileJson2, FlaskConical, Globe, SearchCode, Wifi } from "lucide-react";

import { JsonDiffTool } from "@/features/tools/json-diff-tool";
import { JsonFormatTool } from "@/features/tools/json-format-tool";
import { UrlParamsTool } from "@/features/tools/url-params-tool";
import { pushRecentTool } from "@/shared/storage";
import {
  ALL_TOOLS,
  findToolById,
  type ToolCategory,
  type ToolDefinition
} from "@/shared/tools";

const CATEGORY_META: Record<
  ToolCategory,
  {
    label: string;
    icon: React.ComponentType<{ size?: number }>;
  }
> = {
  json: {
    label: "JSON 工具",
    icon: FileJson2
  },
  page: {
    label: "页面工具",
    icon: Globe
  },
  code: {
    label: "代码工具",
    icon: CodeXml
  },
  network: {
    label: "网络工具",
    icon: Wifi
  },
  regex: {
    label: "正则工具",
    icon: SearchCode
  },
  performance: {
    label: "性能工具",
    icon: FlaskConical
  }
};

const CATEGORY_ORDER: ToolCategory[] = [
  "json",
  "page",
  "code",
  "network",
  "regex",
  "performance"
];

function PlannedToolPlaceholder({ tool }: { tool: ToolDefinition }) {
  return (
    <div className="tool-workbench">
      <div className="info-box">
        {tool.name} 还没有接入当前版本。
      </div>
    </div>
  );
}

function ReadyToolPanel(props: {
  tool: ToolDefinition;
  sourceTabId?: number;
  sourceHost?: string;
}) {
  const { tool, sourceTabId, sourceHost } = props;

  if (tool.id === "url-params") {
    return <UrlParamsTool sourceTabId={sourceTabId} sourceHost={sourceHost} />;
  }

  if (tool.id === "json-format") {
    return <JsonFormatTool />;
  }

  if (tool.id === "json-diff") {
    return <JsonDiffTool />;
  }

  return <PlannedToolPlaceholder tool={tool} />;
}

export function ToolboxApp() {
  const params = new URLSearchParams(window.location.search);
  const toolFromQuery = params.get("tool") ?? "json-format";
  const sourceHost = params.get("sourceHost") ?? undefined;
  const sourceTabId = params.get("sourceTabId")
    ? Number(params.get("sourceTabId"))
    : undefined;

  const initialTool = findToolById(toolFromQuery) ?? findToolById("json-format")!;
  const [selectedCategory, setSelectedCategory] = React.useState<ToolCategory>(
    initialTool.category
  );
  const [selectedToolId, setSelectedToolId] = React.useState(initialTool.id);

  const categoryTools = React.useMemo(
    () => ALL_TOOLS.filter((tool) => tool.category === selectedCategory),
    [selectedCategory]
  );

  React.useEffect(() => {
    const selectedTool = findToolById(selectedToolId);
    if (selectedTool?.category === selectedCategory) {
      return;
    }

    const fallbackTool =
      categoryTools.find((tool) => tool.status === "ready") ?? categoryTools[0];

    if (fallbackTool) {
      setSelectedToolId(fallbackTool.id);
    }
  }, [categoryTools, selectedCategory, selectedToolId]);

  React.useEffect(() => {
    const tool = findToolById(selectedToolId);
    if (!tool) {
      return;
    }

    void pushRecentTool(tool.id);
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set("tool", tool.id);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${nextParams.toString()}`
    );
  }, [selectedToolId]);

  const selectedTool =
    findToolById(selectedToolId) ??
    categoryTools.find((tool) => tool.status === "ready") ??
    categoryTools[0];

  return (
    <main className="toolbox-shell">
      <Tabs.Root
        value={selectedCategory}
        onValueChange={(value) => setSelectedCategory(value as ToolCategory)}
      >
        <Tabs.List className="category-tab-list top-line">
          {CATEGORY_ORDER.map((category) => {
            const Icon = CATEGORY_META[category].icon;
            return (
              <Tabs.Trigger
                key={category}
                value={category}
                className="category-tab-trigger"
              >
                <Icon size={16} />
                <span>{CATEGORY_META[category].label}</span>
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
      </Tabs.Root>

      <div className="tool-inline-tabs">
        {categoryTools.map((tool) => (
          <button
            key={tool.id}
            className={clsx(
              "tool-inline-tab",
              selectedToolId === tool.id && "is-selected"
            )}
            onClick={() => setSelectedToolId(tool.id)}
          >
            {tool.name}
          </button>
        ))}
        {sourceHost ? <span className="meta-pill host-pill">{sourceHost}</span> : null}
      </div>

      <section className="workspace-stage compact-stage">
        {selectedTool ? (
          selectedTool.status === "ready" ? (
            <ReadyToolPanel
              tool={selectedTool}
              sourceTabId={sourceTabId}
              sourceHost={sourceHost}
            />
          ) : (
            <PlannedToolPlaceholder tool={selectedTool} />
          )
        ) : null}
      </section>
    </main>
  );
}
