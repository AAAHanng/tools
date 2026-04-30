import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  HighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import clsx from "clsx";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import React from "react";
import { tags as t } from "@lezer/highlight";

const JSON_SAMPLE = `{
  "hello": "world",
  "items": [1, 2, 3],
  "meta": {
    "source": "toolbox",
    "enabled": true
  },
  "url": "https://example.com"
}`;

type ViewMode = "pretty" | "compact";
type OutputView = "text" | "fold";

type JsonLintError = {
  summary: string;
  line?: number;
  column?: number;
  snippet?: string;
  suggestion: string;
};

type PathQueryResult = {
  state: "idle" | "success" | "missing" | "error";
  message: string;
};

type JsonViewerProps = {
  value: unknown;
  defaultExpandDepth: number;
  resetToken: string;
  childBatchSize?: number;
};

type HighlightedJsonTextProps = {
  text: string;
  clickableLinks?: boolean;
  lightweight?: boolean;
};

type JsonNodeProps = {
  value: unknown;
  label?: string;
  labelType?: "key" | "item";
  depth: number;
  isLast: boolean;
  defaultExpandDepth: number;
  resetToken: string;
  childBatchSize?: number;
};

const URL_PATTERN = /https?:\/\/[^\s"]+/gi;
const JSON_TOKEN_PATTERN =
  /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;
const LARGE_TEXT_THRESHOLD = 120_000;
const HUGE_TEXT_THRESHOLD = 400_000;
const LARGE_LINE_THRESHOLD = 3_000;
const HUGE_LINE_THRESHOLD = 12_000;
const TREE_CHILD_BATCH_SIZE = 200;

const jsonHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.propertyName, color: "#8b1fa9" },
    { tag: t.string, color: "#0f9d58" },
    { tag: t.number, color: "#2563eb" },
    { tag: t.bool, color: "#b45309" },
    { tag: t.null, color: "#94a3b8" },
    { tag: t.punctuation, color: "#64748b" },
    { tag: t.brace, color: "#64748b" },
    { tag: t.squareBracket, color: "#64748b" }
  ]),
  { fallback: true }
);

const jsonEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "#ffffff"
  },
  ".cm-scroller": {
    fontFamily: '"SFMono-Regular","JetBrains Mono","Menlo",monospace',
    lineHeight: "1.55"
  },
  ".cm-content": {
    padding: "12px 14px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    color: "#94a3b8",
    borderRight: "1px solid #e2e8f0"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 0"
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "rgba(37, 99, 235, 0.06)"
  },
  ".cm-link-mark": {
    color: "#2563eb",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "pointer"
  }
});

const urlDecorator = new MatchDecorator({
  regexp: /https?:\/\/[^\s",}]+/g,
  decoration: () => Decoration.mark({ class: "cm-link-mark" })
});

const linkDecoratorExtension = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view: EditorView) {
      this.decorations = urlDecorator.createDeco(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = urlDecorator.updateDeco(update, this.decorations);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("cm-link-mark")) {
          return;
        }

        const position = view.posAtDOM(target);
        const line = view.state.doc.lineAt(position);
        const text = line.text;
        const match = text.match(/https?:\/\/[^\s",}]+/);

        if (match?.[0]) {
          window.open(match[0], "_blank", "noopener,noreferrer");
          event.preventDefault();
        }
      }
    }
  }
);

const baseEditorExtensions = [
  json(),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  bracketMatching(),
  foldGutter(),
  indentOnInput(),
  jsonHighlightStyle,
  jsonEditorTheme,
  EditorView.lineWrapping,
  linkDecoratorExtension
];

function stringifyValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function getItemCountText(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function getDocumentMetrics(text: string) {
  let lineCount = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }

  return {
    lineCount,
    charCount: text.length
  };
}

function getCursorMetrics(text: string, position: number) {
  let line = 1;
  let lastLineBreak = -1;

  for (let index = 0; index < position; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lastLineBreak = index;
    }
  }

  return {
    line,
    column: position - lastLineBreak
  };
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getLineNumbers(lineCount: number) {
  return Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1).join("\n");
}

function getLineSnippet(source: string, line: number) {
  return source.split("\n")[line - 1] ?? "";
}

function getJsonLintSuggestion(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("double-quoted")) {
    return "JSON 的 key 和字符串值都要使用双引号。";
  }

  if (lower.includes("expected ','") || lower.includes("after property value")) {
    return "字段之间或数组项之间缺少逗号。";
  }

  if (lower.includes("expected ':'")) {
    return "key 和 value 之间缺少冒号。";
  }

  if (lower.includes("unexpected token") || lower.includes("unexpected non-whitespace")) {
    return "检查报错位置附近的字符，删除多余内容，或补上缺失的符号。";
  }

  if (lower.includes("unterminated string")) {
    return "字符串没有正确闭合，请补上双引号，必要时转义内部引号。";
  }

  if (lower.includes("end of json input")) {
    return "JSON 末尾缺少内容，请检查是否少了 `}`、`]` 或值本身。";
  }

  return "根据报错行列检查附近的标点、引号或括号。";
}

function buildJsonLintError(source: string, error: unknown): JsonLintError {
  const fallback = {
    summary: error instanceof Error ? error.message : "JSON parse failed",
    suggestion: "请检查 JSON 结构，重点看附近的标点、引号和括号。"
  };

  if (!(error instanceof Error)) {
    return fallback;
  }

  const summary = error.message;
  const positionMatch = summary.match(/position\s+(\d+)/i);

  if (!positionMatch) {
    return {
      summary,
      suggestion: getJsonLintSuggestion(summary)
    };
  }

  const position = Number(positionMatch[1]);
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const before = source.slice(0, safePosition);
  const line = before.split("\n").length;
  const lastLineBreak = before.lastIndexOf("\n");
  const column = safePosition - lastLineBreak;

  return {
    summary,
    line,
    column,
    snippet: getLineSnippet(source, line),
    suggestion: getJsonLintSuggestion(summary)
  };
}

function getStringSegments(value: string) {
  const segments = value.split(URL_PATTERN);
  const matches = value.match(URL_PATTERN) ?? [];

  return { segments, matches };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );

    return Object.fromEntries(
      entries.map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  return value;
}

function encodeJsonStringContent(text: string) {
  return JSON.stringify(text).slice(1, -1);
}

function decodeJsonStringContent(text: string) {
  return JSON.parse(`"${text}"`) as string;
}

function parseSimpleJsonPath(path: string) {
  const normalized = path.trim().replace(/^\$\./, "").replace(/^\$/, "");
  if (!normalized) {
    return [];
  }

  const tokens: Array<string | number> = [];
  const pattern = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2]) {
      tokens.push(Number(match[2]));
    }
  }

  return tokens;
}

function lookupByPath(root: unknown, path: string): PathQueryResult {
  if (!path.trim()) {
    return {
      state: "idle",
      message: ""
    };
  }

  try {
    const tokens = parseSimpleJsonPath(path);
    let current: unknown = root;

    for (const token of tokens) {
      if (typeof token === "number") {
        if (!Array.isArray(current) || current[token] === undefined) {
          return {
            state: "missing",
            message: "未找到匹配项"
          };
        }
        current = current[token];
        continue;
      }

      if (
        typeof current !== "object" ||
        current === null ||
        !(token in (current as Record<string, unknown>))
      ) {
        return {
          state: "missing",
          message: "未找到匹配项"
        };
      }

      current = (current as Record<string, unknown>)[token];
    }

    return {
      state: "success",
      message: stringifyValue(current)
    };
  } catch {
    return {
      state: "error",
      message: "路径格式无效"
    };
  }
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (typeof value === "string") {
    const escapedValue = JSON.stringify(value).slice(1, -1);
    const { segments, matches } = getStringSegments(escapedValue);

    return (
      <span className="json-string">
        "
        {segments.map((segment, index) => (
          <React.Fragment key={`${segment}-${index}`}>
            {segment}
            {matches?.[index] ? (
              <a
                className="json-link"
                href={matches[index]}
                target="_blank"
                rel="noreferrer"
              >
                {matches[index]}
              </a>
            ) : null}
          </React.Fragment>
        ))}
        "
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="json-number">{value}</span>;
  }

  if (typeof value === "boolean") {
    return <span className="json-boolean">{String(value)}</span>;
  }

  if (value === null) {
    return <span className="json-null">null</span>;
  }

  return <span className="json-null">null</span>;
}

function HighlightedJsonText(props: HighlightedJsonTextProps) {
  const { text, clickableLinks = false, lightweight = false } = props;
  const content = React.useMemo(() => {
    if (lightweight) {
      return text || " ";
    }

    const tokens: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;

    JSON_TOKEN_PATTERN.lastIndex = 0;

    while ((match = JSON_TOKEN_PATTERN.exec(text)) !== null) {
      const [raw] = match;
      const start = match.index;
      const end = start + raw.length;

      if (start > cursor) {
        tokens.push(text.slice(cursor, start));
      }

      if (raw[0] === '"') {
        const isKey = /^\s*:/.test(text.slice(end));
        if (isKey) {
          tokens.push(
            <span key={`${start}-key`} className="json-key">
              {raw}
            </span>
          );
        } else if (clickableLinks) {
          const inner = raw.slice(1, -1);
          const { segments, matches } = getStringSegments(inner);
          tokens.push(
            <span key={`${start}-string`} className="json-string">
              "
              {segments.map((segment, index) => (
                <React.Fragment key={`${start}-${index}`}>
                  {segment}
                  {matches[index] ? (
                    <a
                      className="json-link"
                      href={matches[index]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {matches[index]}
                    </a>
                  ) : null}
                </React.Fragment>
              ))}
              "
            </span>
          );
        } else {
          tokens.push(
            <span key={`${start}-string`} className="json-string">
              {raw}
            </span>
          );
        }
      } else if (raw === "true" || raw === "false") {
        tokens.push(
          <span key={`${start}-boolean`} className="json-boolean">
            {raw}
          </span>
        );
      } else if (raw === "null") {
        tokens.push(
          <span key={`${start}-null`} className="json-null">
            {raw}
          </span>
        );
      } else if (/^-?\d/.test(raw)) {
        tokens.push(
          <span key={`${start}-number`} className="json-number">
            {raw}
          </span>
        );
      } else {
        tokens.push(
          <span key={`${start}-punctuation`} className="json-punctuation">
            {raw}
          </span>
        );
      }

      cursor = end;
    }

    if (cursor < text.length) {
      tokens.push(text.slice(cursor));
    }

    return tokens.length ? tokens : " ";
  }, [clickableLinks, lightweight, text]);

  return (
    <pre className={clsx("json-text-view", lightweight && "is-lightweight")}>
      {content}
    </pre>
  );
}

function JsonNode(props: JsonNodeProps) {
  const {
    value,
    label,
    labelType = "key",
    depth,
    isLast,
    defaultExpandDepth,
    resetToken,
    childBatchSize
  } = props;
  const isArray = Array.isArray(value);
  const isObject = typeof value === "object" && value !== null && !isArray;
  const entries = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : isObject
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const isExpandable = isArray || isObject;
  const [open, setOpen] = React.useState(depth < defaultExpandDepth);
  const batchSize = childBatchSize ?? Number.MAX_SAFE_INTEGER;
  const [visibleCount, setVisibleCount] = React.useState(
    Math.min(entries.length, batchSize)
  );
  const countText = getItemCountText(entries.length);

  React.useEffect(() => {
    setOpen(depth < defaultExpandDepth);
  }, [defaultExpandDepth, depth, resetToken]);

  React.useEffect(() => {
    setVisibleCount(Math.min(entries.length, batchSize));
  }, [batchSize, entries.length, resetToken]);

  const paddingLeft = depth * 18;
  const visibleEntries = entries.slice(0, visibleCount);
  const hiddenCount = Math.max(0, entries.length - visibleCount);

  if (!isExpandable) {
    return (
      <div className="json-line" style={{ paddingLeft }}>
        <span className="json-arrow-spacer" />
        {label !== undefined ? (
          <>
            {labelType === "key" ? (
              <span className="json-key">"{label}"</span>
            ) : (
              <span className="json-item-label">item {label}</span>
            )}
            <span className="json-punctuation">: </span>
          </>
        ) : null}
        <JsonPrimitive value={value} />
        {!isLast ? <span className="json-punctuation">,</span> : null}
      </div>
    );
  }

  const itemLabel = isArray ? "array" : "object";

  return (
    <div className="json-block">
      <div className="json-line" style={{ paddingLeft }}>
        <button
          className="json-arrow"
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {label !== undefined ? (
          <>
            {labelType === "key" ? (
              <span className="json-key">"{label}"</span>
            ) : (
              <span className="json-item-label">item {label}</span>
            )}
            <span className="json-punctuation">: </span>
          </>
        ) : null}
        <span className="json-punctuation">{isArray ? "[" : "{"}</span>
        {!open ? (
          <>
            <span className="json-collapsed-placeholder">...</span>
            <span className="json-collapsed-meta">
              {itemLabel}, {countText}
            </span>
            <span className="json-punctuation">{isArray ? "]" : "}"}</span>
            {!isLast ? <span className="json-punctuation">,</span> : null}
          </>
        ) : null}
      </div>

      {open ? (
        <>
          <div className="json-children">
            {visibleEntries.map(([entryLabel, entryValue], index) => (
              <JsonNode
                key={`${depth}-${entryLabel}-${index}`}
                value={entryValue}
                label={entryLabel}
                labelType={isArray ? "item" : "key"}
                depth={depth + 1}
                isLast={hiddenCount === 0 && index === visibleEntries.length - 1}
                defaultExpandDepth={defaultExpandDepth}
                resetToken={resetToken}
                childBatchSize={childBatchSize}
              />
            ))}
            {hiddenCount > 0 ? (
              <div
                className="json-line json-more-row"
                style={{ paddingLeft: (depth + 1) * 18 }}
              >
                <span className="json-arrow-spacer" />
                <button
                  className="json-more-button"
                  onClick={() =>
                    setVisibleCount((current) =>
                      Math.min(entries.length, current + batchSize)
                    )
                  }
                >
                  显示更多 {Math.min(batchSize, hiddenCount)} 项
                </button>
                <span className="json-collapsed-meta">剩余 {hiddenCount} 项</span>
              </div>
            ) : null}
          </div>
          <div className="json-line" style={{ paddingLeft }}>
            <span className="json-arrow-spacer" />
            <span className="json-punctuation">{isArray ? "]" : "}"}</span>
            {!isLast ? <span className="json-punctuation">,</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function JsonViewer(props: JsonViewerProps) {
  const { value, defaultExpandDepth, resetToken, childBatchSize } = props;

  return (
    <div className="json-viewer">
      <JsonNode
        value={value}
        depth={0}
        isLast
        defaultExpandDepth={defaultExpandDepth}
        resetToken={resetToken}
        childBatchSize={childBatchSize}
      />
    </div>
  );
}

export function JsonFormatTool() {
  const [input, setInput] = React.useState(JSON_SAMPLE);
  const [error, setError] = React.useState<JsonLintError | null>(null);
  const [indent, setIndent] = React.useState("2");
  const [fontSize, setFontSize] = React.useState("13");
  const [sortKeys, setSortKeys] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>("pretty");
  const [outputView, setOutputView] = React.useState<OutputView>("text");
  const [showMoreTools, setShowMoreTools] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [cursorMetrics, setCursorMetrics] = React.useState({ line: 1, column: 1 });
  const [parseRevision, setParseRevision] = React.useState(0);
  const [pathQuery, setPathQuery] = React.useState("");
  const [pathResult, setPathResult] = React.useState<PathQueryResult>({
    state: "idle",
    message: ""
  });
  const [treeDepth, setTreeDepth] = React.useState(2);
  const [parsedValue, setParsedValue] = React.useState<unknown>(
    JSON.parse(JSON_SAMPLE)
  );
  const [outputText, setOutputText] = React.useState(
    JSON.stringify(JSON.parse(JSON_SAMPLE), null, 2)
  );
  const [leftPaneWidth, setLeftPaneWidth] = React.useState(34);
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{
    active: boolean;
  }>({ active: false });

  const inputMetrics = React.useMemo(() => getDocumentMetrics(input), [input]);
  const outputMetrics = React.useMemo(
    () => getDocumentMetrics(outputText || ""),
    [outputText]
  );
  const isLargeDocument =
    input.length > LARGE_TEXT_THRESHOLD || inputMetrics.lineCount > LARGE_LINE_THRESHOLD;
  const isHugeDocument =
    input.length > HUGE_TEXT_THRESHOLD || inputMetrics.lineCount > HUGE_LINE_THRESHOLD;
  const shouldUseLightweightInput = isLargeDocument;
  const shouldUseLightweightOutput =
    outputText.length > LARGE_TEXT_THRESHOLD || outputMetrics.lineCount > LARGE_LINE_THRESHOLD;
  const parseDelay = isHugeDocument ? 180 : isLargeDocument ? 80 : 0;

  React.useEffect(() => {
    let cancelled = false;
    const scheduleId = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(input);
        const normalized = sortKeys ? sortJsonValue(parsed) : parsed;
        const space = viewMode === "pretty" ? Number(indent) || 2 : 0;

        if (cancelled) {
          return;
        }

        setParsedValue(normalized);
        setOutputText(JSON.stringify(normalized, null, space));
        setError(null);
        setParseRevision((current) => current + 1);
      } catch (formatError) {
        if (cancelled) {
          return;
        }

        setParsedValue(null);
        setOutputText("");
        setError(buildJsonLintError(input, formatError));
      } finally {
        if (!cancelled) {
          setIsProcessing(false);
        }
      }
    }, parseDelay);

    setIsProcessing(parseDelay > 0);

    return () => {
      cancelled = true;
      window.clearTimeout(scheduleId);
    };
  }, [indent, input, parseDelay, sortKeys, viewMode]);

  React.useEffect(() => {
    if (!pathQuery.trim()) {
      setPathResult({ state: "idle", message: "" });
      return;
    }

    if (!error) {
      setPathResult(lookupByPath(parsedValue, pathQuery));
      return;
    }

    setPathResult({
      state: "error",
      message: "JSON 无法解析"
    });
  }, [error, parsedValue, pathQuery]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current.active || !splitContainerRef.current) {
        return;
      }

      const rect = splitContainerRef.current.getBoundingClientRect();
      const nextRatio = ((event.clientX - rect.left) / rect.width) * 100;
      setLeftPaneWidth(Math.max(24, Math.min(76, nextRatio)));
    };

    const handlePointerUp = () => {
      dragStateRef.current.active = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const copyOutput = async () => {
    if (!outputText) {
      return;
    }

    await navigator.clipboard.writeText(outputText);
  };

  const handleInputEditorChange = React.useCallback((value: string) => {
    setInput(value);
  }, []);

  const inputEditorExtensions = React.useMemo(
    () => [
      ...baseEditorExtensions,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) {
          return;
        }

        const head = update.state.selection.main.head;
        setCursorMetrics(getCursorMetrics(update.state.doc.toString(), head));
      })
    ],
    []
  );

  const outputEditorExtensions = React.useMemo(
    () => [
      ...baseEditorExtensions,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false)
    ],
    []
  );

  const applyInputTransform = (transform: (current: string) => string) => {
    try {
      const nextValue = transform(input);
      setInput(nextValue);
    } catch (transformError) {
      setError({
        summary:
          transformError instanceof Error
            ? transformError.message
            : "内容转换失败",
        suggestion: "请确认当前内容是否适合执行这个转换操作。"
      });
    }
  };

  const outputDepth = outputView === "text" ? 99 : treeDepth;
  const resetToken = `${outputView}-${outputDepth}-${sortKeys}-${parseRevision}`;
  const editorFontSize = Math.max(12, Math.min(28, Number(fontSize) || 13));
  const isAllExpanded = outputView === "fold" && treeDepth >= 99;
  const toggleExpandAll = () => {
    setOutputView("fold");
    setTreeDepth(isAllExpanded ? 1 : 99);
  };

  return (
    <div className="tool-workbench no-gap-top">
      <div className="toolbar-stack">
        <div className="workbench-toolbar single-line-toolbar">
          <button
            className="mini-switch"
            onClick={() =>
              applyInputTransform((current) => encodeURIComponent(current))
            }
          >
            URL 转义
          </button>
          <button
            className="mini-switch"
            onClick={() =>
              applyInputTransform((current) => decodeURIComponent(current))
            }
          >
            URL 还原
          </button>
          <button
            className="mini-switch"
            onClick={() =>
              applyInputTransform((current) => encodeJsonStringContent(current))
            }
          >
            嵌套转义
          </button>
          <button
            className="mini-switch"
            onClick={() =>
              applyInputTransform((current) => decodeJsonStringContent(current))
            }
          >
            嵌套还原
          </button>
          <button
            className={clsx("mini-switch", viewMode === "pretty" && "is-active")}
            onClick={() => setViewMode("pretty")}
          >
            格式化
          </button>
          <button
            className={clsx("mini-switch", viewMode === "compact" && "is-active")}
            onClick={() => setViewMode("compact")}
          >
            压缩
          </button>
          <label className="compact-field small">
            <span>缩进</span>
            <select
              value={indent}
              onChange={(event) => setIndent(event.target.value)}
              disabled={viewMode === "compact"}
            >
              <option value="2">2</option>
              <option value="4">4</option>
              <option value="8">8</option>
            </select>
          </label>
          <label className="compact-field small">
            <span>字号</span>
            <input
              className="compact-number-input"
              value={fontSize}
              onChange={(event) => setFontSize(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            className={clsx("mini-switch", sortKeys && "is-active")}
            onClick={() => setSortKeys((current) => !current)}
          >
            排序
          </button>
          <button className="mini-switch" onClick={copyOutput}>
            复制
          </button>
          <button
            className={clsx("mini-switch", showMoreTools && "is-active")}
            onClick={() => setShowMoreTools((current) => !current)}
          >
            工具
          </button>
          <div className="toolbar-spacer" />
          <button
            className={clsx("mini-switch", outputView === "text" && "is-active")}
            onClick={() => setOutputView("text")}
          >
            文本
          </button>
          <button
            className={clsx("mini-switch", outputView === "fold" && "is-active")}
            onClick={() => setOutputView("fold")}
          >
            折叠
          </button>
          <button
            className={clsx("mini-switch", outputView === "fold" && "is-active")}
            onClick={toggleExpandAll}
          >
            {isAllExpanded ? "全部折叠" : "全部展开"}
          </button>
        </div>
      </div>

      {showMoreTools ? (
        <section className="assistant-panel compact-tools-panel">
          <div className="assistant-grid compact-assistant-grid">
            <div className="assistant-card">
              <div className="assistant-card-head compact-card-head">
                <strong>JSONPath</strong>
              </div>
              <input
                className="assistant-input"
                value={pathQuery}
                onChange={(event) => setPathQuery(event.target.value)}
                placeholder="$.meta.source 或 items[0]"
              />
              {pathResult.message ? (
                <div
                  className={clsx(
                    "assistant-result",
                    pathResult.state === "success" && "is-success",
                    (pathResult.state === "error" ||
                      pathResult.state === "missing") &&
                      "is-error"
                  )}
                >
                  {pathResult.message}
                </div>
              ) : null}
            </div>

            <div className="assistant-card">
              <div className="assistant-card-head compact-card-head">
                <strong>折叠</strong>
              </div>
              <div className="button-row">
                <button
                  className="ghost-button"
                  onClick={() => {
                    setOutputView("fold");
                    setTreeDepth(1);
                  }}
                >
                  全部折叠
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setOutputView("fold");
                    setTreeDepth(2);
                  }}
                >
                  第 2 层
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setOutputView("fold");
                    setTreeDepth(99);
                  }}
                >
                  全部展开
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div
        ref={splitContainerRef}
        className="resizable-workbench"
        style={
          {
            "--left-pane-width": `${leftPaneWidth}%`
          } as React.CSSProperties
        }
      >
        <section className={clsx("editor-panel", error && "is-error-panel")}>
          <div className="editor-panel-head">
            <strong>输入</strong>
            <span>
              行 {cursorMetrics.line} / 列 {cursorMetrics.column} · 共 {inputMetrics.lineCount} 行 · {formatBytes(inputMetrics.charCount)}
              {shouldUseLightweightInput ? " · 轻量模式" : ""}
            </span>
          </div>
          <div className="code-mirror-shell" style={{ fontSize: editorFontSize }}>
            <CodeMirror
              value={input}
              height="100%"
              extensions={inputEditorExtensions}
              onChange={handleInputEditorChange}
              basicSetup={{
                foldGutter: true,
                lineNumbers: true
              }}
            />
          </div>
        </section>

        <div
          className="splitter"
          onPointerDown={(event) => {
            event.preventDefault();
            dragStateRef.current.active = true;
          }}
        >
          <GripVertical size={14} />
        </div>

        <section className={clsx("editor-panel", error && "is-error-panel")}>
          <div className="editor-panel-head">
            <strong>输出</strong>
            <span>
              {isProcessing
                ? "处理中..."
                : `共 ${outputMetrics.lineCount} 行 · ${formatBytes(outputMetrics.charCount)}`}
              {shouldUseLightweightOutput ? " · 轻量模式" : ""}
            </span>
          </div>
          <div className="tree-panel" style={{ fontSize: editorFontSize }}>
            {isProcessing ? (
              <div className="json-loading-state">
                <span className="spinner" />
                <span>正在解析大体量 JSON...</span>
              </div>
            ) : !error ? (
              outputView === "text" ? (
                <div className="code-mirror-shell" style={{ fontSize: editorFontSize }}>
                  <CodeMirror
                    value={outputText}
                    height="100%"
                    editable={false}
                    extensions={outputEditorExtensions}
                    basicSetup={{
                      foldGutter: true,
                      lineNumbers: true
                    }}
                  />
                </div>
              ) : (
                <div className="output-content">
                  <JsonViewer
                    value={parsedValue}
                    defaultExpandDepth={outputDepth}
                    resetToken={resetToken}
                    childBatchSize={shouldUseLightweightOutput ? TREE_CHILD_BATCH_SIZE : undefined}
                  />
                </div>
              )
            ) : (
              <div className="json-error-inline output-content">
                <strong>JSONLint</strong>
                <span>{error.summary}</span>
                {error.line && error.column ? (
                  <span>
                    第 {error.line} 行，第 {error.column} 列
                  </span>
                ) : null}
                {error.snippet ? <code>{error.snippet}</code> : null}
                <span>{error.suggestion}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
