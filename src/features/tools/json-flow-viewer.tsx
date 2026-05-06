import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React from "react";

type JsonFlowNodeData = Record<string, unknown> & {
  label: string;
  kind: "object" | "array" | "value" | "stringified object" | "stringified array";
  preview: string;
  count?: number;
  path: JsonPath;
  onSelectPath?: (path: JsonPath) => void;
};

type JsonPathSegment = string | number;
type JsonPath = JsonPathSegment[];

type StringifiedJsonDescriptor = {
  value: Record<string, unknown> | unknown[];
  kind: "object" | "array";
  count: number;
};

const FLOW_MAX_NODES = 160;
const LARGE_TEXT_THRESHOLD = 120_000;
const STRINGIFIED_JSON_PREFIX_PATTERN = /^\s*[\[{]/;

function getItemCountText(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function resolveStringifiedJson(text: string): StringifiedJsonDescriptor | null {
  if (
    !text ||
    text.length > LARGE_TEXT_THRESHOLD ||
    !STRINGIFIED_JSON_PREFIX_PATTERN.test(text)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return {
        value: parsed,
        kind: "array",
        count: parsed.length
      };
    }

    if (typeof parsed === "object" && parsed !== null) {
      return {
        value: parsed as Record<string, unknown>,
        kind: "object",
        count: Object.keys(parsed).length
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getFlowPreview(value: unknown) {
  if (typeof value === "string") {
    return value.length > 42 ? `${value.slice(0, 42)}...` : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }

  if (typeof value === "object" && value !== null) {
    const count = Object.keys(value).length;
    return `${count} ${count === 1 ? "field" : "fields"}`;
  }

  return "";
}

function JsonFlowNode({ data }: NodeProps<Node<JsonFlowNodeData>>) {
  return (
    <button
      className="json-flow-node"
      onClick={() => data.onSelectPath?.(data.path)}
      type="button"
    >
      <Handle type="target" position={Position.Left} className="json-flow-handle" />
      <div className="json-flow-node-head">
        <strong>{data.label}</strong>
        <span>{data.kind}</span>
      </div>
      <div className="json-flow-node-preview">{data.preview}</div>
      {data.count !== undefined ? (
        <div className="json-flow-node-count">{getItemCountText(data.count)}</div>
      ) : null}
      <Handle type="source" position={Position.Right} className="json-flow-handle" />
    </button>
  );
}

const jsonFlowNodeTypes = {
  jsonNode: JsonFlowNode
};

function buildJsonFlow(value: unknown, onSelectPath?: (path: JsonPath) => void) {
  const nodes: Array<Node<JsonFlowNodeData>> = [];
  const edges: Edge[] = [];
  const levelCounts = new Map<number, number>();
  let nodeCount = 0;

  const visit = (
    currentValue: unknown,
    label: string,
    depth: number,
    path: JsonPath,
    parentId?: string
  ) => {
    if (nodeCount >= FLOW_MAX_NODES) {
      return;
    }

    const nestedJson =
      typeof currentValue === "string" ? resolveStringifiedJson(currentValue) : null;
    const resolvedValue = nestedJson?.value ?? currentValue;
    const isArray = Array.isArray(resolvedValue);
    const isObject =
      typeof resolvedValue === "object" && resolvedValue !== null && !isArray;
    const entries = isArray
      ? (resolvedValue as unknown[]).map((item, index) => [String(index), item] as const)
      : isObject
        ? Object.entries(resolvedValue as Record<string, unknown>)
        : [];
    const levelIndex = levelCounts.get(depth) ?? 0;
    levelCounts.set(depth, levelIndex + 1);

    const id = `flow-${nodeCount}`;
    nodeCount += 1;

    const kind = nestedJson
      ? (`stringified ${nestedJson.kind}` as JsonFlowNodeData["kind"])
      : isArray
        ? "array"
        : isObject
          ? "object"
          : "value";

    nodes.push({
      id,
      type: "jsonNode",
      position: {
        x: depth * 260,
        y: levelIndex * 126
      },
      data: {
        label,
        kind,
        preview: getFlowPreview(resolvedValue),
        count: entries.length || undefined,
        path,
        onSelectPath
      }
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${id}`,
        source: parentId,
        target: id,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed
        }
      });
    }

    for (const [entryLabel, entryValue] of entries) {
      visit(
        entryValue,
        isArray ? `item ${entryLabel}` : entryLabel,
        depth + 1,
        [...path, isArray ? Number(entryLabel) : entryLabel],
        id
      );
    }
  };

  visit(value, "root", 0, []);

  return {
    nodes,
    edges,
    truncated: nodeCount >= FLOW_MAX_NODES
  };
}

export default function JsonFlowViewer({
  value,
  onSelectPath
}: {
  value: unknown;
  onSelectPath?: (path: JsonPath) => void;
}) {
  const flow = React.useMemo(() => buildJsonFlow(value, onSelectPath), [onSelectPath, value]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);

  React.useEffect(() => {
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [flow.edges, flow.nodes, setEdges, setNodes]);

  return (
    <div className="json-flow-shell">
      {flow.truncated ? (
        <div className="json-flow-limit">节点过多，仅展示前 {FLOW_MAX_NODES} 个</div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={jsonFlowNodeTypes}
        fitView
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
