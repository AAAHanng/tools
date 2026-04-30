export type ToolCategory = "page" | "json" | "code" | "network" | "regex" | "performance";
export type ToolStatus = "ready" | "planned";

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
};

export const ALL_TOOLS: ToolDefinition[] = [
  {
    id: "url-params",
    name: "URL 参数工具",
    description: "向当前页面写入调试参数，适合 EXTENSION_DEBUG 这类场景。",
    category: "page",
    status: "ready"
  },
  {
    id: "json-format",
    name: "JSON 美化工具",
    description: "格式化、压缩并校验 JSON 内容。",
    category: "json",
    status: "ready"
  },
  {
    id: "json-diff",
    name: "JSON 对比工具",
    description: "对比两段 JSON 的字段和值差异。",
    category: "json",
    status: "ready"
  },
  {
    id: "code-format",
    name: "代码美化工具",
    description: "多语言格式化入口，后续接 prettier 与语言适配。",
    category: "code",
    status: "planned"
  },
  {
    id: "code-minify",
    name: "代码压缩工具",
    description: "面向 HTML、CSS、JavaScript 的轻量压缩能力。",
    category: "code",
    status: "planned"
  },
  {
    id: "http-client",
    name: "简易 Postman",
    description: "基础接口调试工具，后续补请求历史和环境变量。",
    category: "network",
    status: "planned"
  },
  {
    id: "websocket",
    name: "WebSocket 工具",
    description: "连接、发送与消息调试面板。",
    category: "network",
    status: "planned"
  },
  {
    id: "regex",
    name: "正则公式速查",
    description: "常见表达式模板和实时匹配实验区。",
    category: "regex",
    status: "planned"
  },
  {
    id: "performance",
    name: "网站性能优化",
    description: "围绕页面指标和资源信息的性能观察入口。",
    category: "performance",
    status: "planned"
  }
];

export const READY_TOOLS = ALL_TOOLS.filter((tool) => tool.status === "ready");

export function findToolById(toolId: string) {
  return ALL_TOOLS.find((tool) => tool.id === toolId);
}

