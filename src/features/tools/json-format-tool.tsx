import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  HighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { EditorSelection, EditorState, RangeSetBuilder } from "@codemirror/state";
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
import { ChevronDown, ChevronRight, Copy, GripVertical, Redo2, Trash2, Undo2 } from "lucide-react";
import React from "react";
import { tags as t } from "@lezer/highlight";
import {
  consumePendingJsonInput,
  getJsonHistory,
  setJsonHistory,
  type JsonHistoryEntry
} from "@/shared/storage";
import {
  JsonHistoryDragProvider,
  JsonHistoryDropZone,
  JsonHistorySidebar,
  reorderJsonHistoryEntries
} from "@/components/ui/json-history-sidebar";
import { DragHandle } from "@/components/ui/drag-handle";

const JSON_SAMPLE = `{
  "hello": "world",
  "items": [1, 2, 3],
  "meta": {
    "source": "toolbox",
    "enabled": true
  },
  "url": "https://example.com"
}`;

const JsonFlowViewer = React.lazy(() => import("./json-flow-viewer"));

type ViewMode = "pretty" | "compact";
type OutputView = "text" | "fold" | "flow";
type InputView = "edit" | "fold";
type JsonPathSegment = string | number;
export type JsonPath = JsonPathSegment[];

type JsonToolSnapshot = {
  input: string;
  indent: string;
  sortKeys: boolean;
  viewMode: ViewMode;
};

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
  showLineNumbers?: boolean;
  editable?: boolean;
  onChange?: (nextValue: unknown) => void;
  onSelectPath?: (path: JsonPath, value: unknown) => void;
  selectedPath?: JsonPath | null;
  dragState?: JsonDragState | null;
  onDragStart?: (path: JsonPath) => void;
  onDragOverPath?: (path: JsonPath, position: JsonDropPosition) => void;
  onDropPath?: (path: JsonPath, position: JsonDropPosition) => void;
  onDragEnd?: () => void;
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
  showLineNumbers?: boolean;
  editable?: boolean;
  onChange?: (nextValue: unknown) => void;
  path?: JsonPath;
  onSelectPath?: (path: JsonPath, value: unknown) => void;
  selectedPath?: JsonPath | null;
  dragState?: JsonDragState | null;
  onDragStart?: (path: JsonPath) => void;
  onDragOverPath?: (path: JsonPath, position: JsonDropPosition) => void;
  onDropPath?: (path: JsonPath, position: JsonDropPosition) => void;
  onDragEnd?: () => void;
};

type JsonLineProps = {
  depth: number;
  showLineNumbers?: boolean;
  className?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
};

type CopyPreview = {
  title: string;
  meta: string;
  preview: string;
};

type JsonCopyMode = "property" | "value" | "object";
type JsonDropPosition = "before" | "after";

type JsonDropTarget = {
  path: JsonPath;
  position: JsonDropPosition;
};

type JsonDragState = {
  path: JsonPath;
  target?: JsonDropTarget;
};

const URL_PATTERN = /https?:\/\/[^\s"]+/gi;
const URL_EDITOR_PATTERN = /https?:\/\/[^\s",}]+/g;
const JSON_STRING_PATTERN = /"(?:\\.|[^"\\])*"/g;
const JSON_TOKEN_PATTERN =
  /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;
const LARGE_TEXT_THRESHOLD = 120_000;
const HUGE_TEXT_THRESHOLD = 400_000;
const LARGE_LINE_THRESHOLD = 3_000;
const HUGE_LINE_THRESHOLD = 12_000;
const TREE_CHILD_BATCH_SIZE = 200;
const STRINGIFIED_JSON_PREFIX_PATTERN = /^\s*[\[{]/;
const MAX_JSON_HISTORY_ITEMS = 18;
const MAX_UNDO_STACK_SIZE = 80;

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
  },
  ".cm-nested-json-key": {
    color: "#8b1fa9"
  },
  ".cm-nested-json-string": {
    color: "#0f9d58"
  },
  ".cm-nested-json-number": {
    color: "#2563eb"
  },
  ".cm-nested-json-boolean": {
    color: "#b45309"
  },
  ".cm-nested-json-null": {
    color: "#94a3b8"
  },
  ".cm-nested-json-punctuation": {
    color: "#64748b"
  }
});

const urlDecorator = new MatchDecorator({
  regexp: URL_EDITOR_PATTERN,
  decoration: () => Decoration.mark({ class: "cm-link-mark" })
});

type JsonTokenKind =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

type StringifiedJsonDescriptor = {
  value: Record<string, unknown> | unknown[];
  kind: "object" | "array";
  count: number;
};

function getNestedTokenColor(kind: JsonTokenKind) {
  switch (kind) {
    case "key":
      return "#8b1fa9";
    case "string":
      return "#0f9d58";
    case "number":
      return "#2563eb";
    case "boolean":
      return "#b45309";
    case "null":
      return "#94a3b8";
    default:
      return "#64748b";
  }
}

const nestedTokenDecorations = {
  key: Decoration.mark({
    attributes: {
      class: "cm-nested-json-key",
      style: `color: ${getNestedTokenColor("key")};`
    }
  }),
  string: Decoration.mark({
    attributes: {
      class: "cm-nested-json-string",
      style: `color: ${getNestedTokenColor("string")};`
    }
  }),
  number: Decoration.mark({
    attributes: {
      class: "cm-nested-json-number",
      style: `color: ${getNestedTokenColor("number")};`
    }
  }),
  boolean: Decoration.mark({
    attributes: {
      class: "cm-nested-json-boolean",
      style: `color: ${getNestedTokenColor("boolean")};`
    }
  }),
  null: Decoration.mark({
    attributes: {
      class: "cm-nested-json-null",
      style: `color: ${getNestedTokenColor("null")};`
    }
  }),
  punctuation: Decoration.mark({
    attributes: {
      class: "cm-nested-json-punctuation",
      style: `color: ${getNestedTokenColor("punctuation")};`
    }
  })
} as const;

function getTokenKind(
  token: string,
  source: string,
  tokenEnd: number
): JsonTokenKind {
  if (token[0] === '"') {
    return /^\s*:/.test(source.slice(tokenEnd)) ? "key" : "string";
  }

  if (token === "true" || token === "false") {
    return "boolean";
  }

  if (token === "null") {
    return "null";
  }

  if (/^-?\d/.test(token)) {
    return "number";
  }

  return "punctuation";
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

function buildEscapedOffsetMap(rawContent: string) {
  const offsets = [0];
  let cursor = 0;

  while (cursor < rawContent.length) {
    const current = rawContent[cursor];

    if (current !== "\\") {
      cursor += 1;
      offsets.push(cursor);
      continue;
    }

    const next = rawContent[cursor + 1];

    if (!next) {
      return null;
    }

    if (next === "u") {
      const unicodeBody = rawContent.slice(cursor + 2, cursor + 6);

      if (!/^[0-9a-fA-F]{4}$/.test(unicodeBody)) {
        return null;
      }

      cursor += 6;
      offsets.push(cursor);
      continue;
    }

    if (`"\\/bfnrt`.includes(next)) {
      cursor += 2;
      offsets.push(cursor);
      continue;
    }

    return null;
  }

  return offsets;
}

function buildNestedJsonDecorations(text: string, offsetBase: number) {
  const ranges: Array<{
    from: number;
    to: number;
    kind: JsonTokenKind;
  }> = [];
  let outerMatch: RegExpExecArray | null;

  JSON_STRING_PATTERN.lastIndex = 0;

  while ((outerMatch = JSON_STRING_PATTERN.exec(text)) !== null) {
    const rawStringToken = outerMatch[0];
    let decodedString: string;

    try {
      const parsedToken = JSON.parse(rawStringToken);

      if (typeof parsedToken !== "string") {
        continue;
      }

      decodedString = parsedToken;
    } catch {
      continue;
    }

    const nestedJson = resolveStringifiedJson(decodedString);

    if (!nestedJson) {
      continue;
    }

    const offsetMap = buildEscapedOffsetMap(rawStringToken.slice(1, -1));

    if (!offsetMap) {
      continue;
    }

    let innerMatch: RegExpExecArray | null;

    JSON_TOKEN_PATTERN.lastIndex = 0;

    while ((innerMatch = JSON_TOKEN_PATTERN.exec(decodedString)) !== null) {
      const token = innerMatch[0];
      const tokenStart = innerMatch.index;
      const tokenEnd = tokenStart + token.length;
      const from = offsetBase + outerMatch.index + 1 + offsetMap[tokenStart];
      const to = offsetBase + outerMatch.index + 1 + offsetMap[tokenEnd];

      ranges.push({
        from,
        to,
        kind: getTokenKind(token, decodedString, tokenEnd)
      });
    }
  }

  return ranges;
}

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
        const column = position - line.from;
        let match: RegExpExecArray | null;

        URL_EDITOR_PATTERN.lastIndex = 0;

        while ((match = URL_EDITOR_PATTERN.exec(line.text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;

          if (column >= start && column <= end) {
            window.open(match[0], "_blank", "noopener,noreferrer");
            event.preventDefault();
            return;
          }
        }
      }
    }
  }
);

const nestedJsonDecoratorExtension = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc.toString();
      const shouldScanWholeDocument =
        doc.length <= LARGE_TEXT_THRESHOLD &&
        view.state.doc.lines <= LARGE_LINE_THRESHOLD;

      if (shouldScanWholeDocument) {
        const ranges = buildNestedJsonDecorations(doc, 0);

        for (const range of ranges) {
          builder.add(range.from, range.to, nestedTokenDecorations[range.kind]);
        }

        return builder.finish();
      }

      for (const { from, to } of view.visibleRanges) {
        const lineFrom = view.state.doc.lineAt(from).from;
        const lineTo = view.state.doc.lineAt(Math.max(from, to - 1)).to;
        const text = view.state.doc.sliceString(lineFrom, lineTo);
        const ranges = buildNestedJsonDecorations(text, lineFrom);

        for (const range of ranges) {
          builder.add(range.from, range.to, nestedTokenDecorations[range.kind]);
        }
      }

      return builder.finish();
    }
  },
  {
    decorations: (value) => value.decorations
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
  linkDecoratorExtension,
  nestedJsonDecoratorExtension
];

export const baseJsonEditorExtensions = baseEditorExtensions;

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

function toClipboardJsonText(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return JSON.stringify(value);
  }

  return JSON.stringify(value, null, 2);
}

function toClipboardValueText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function getCopyPreview(value: unknown, title?: string, clipboardText = toClipboardJsonText(value)): CopyPreview {
  const compactPreview = clipboardText.replace(/\s+/g, " ").trim();
  const preview =
    compactPreview.length > 180
      ? `${compactPreview.slice(0, 180)}...`
      : compactPreview;

  if (Array.isArray(value)) {
    return {
      title: title ?? "复制当前数组层",
      meta: `${value.length} 项 · ${clipboardText.length} 字符`,
      preview
    };
  }

  if (typeof value === "object" && value !== null) {
    return {
      title: title ?? "复制当前对象层",
      meta: `${Object.keys(value as Record<string, unknown>).length} 个字段 · ${clipboardText.length} 字符`,
      preview
    };
  }

  return {
    title: title ?? "复制当前值",
    meta: `${clipboardText.length} 字符`,
    preview
  };
}

function getJsonPropertyClipboardText(
  label: string | undefined,
  labelType: "key" | "item",
  value: unknown
) {
  const valueText = toClipboardJsonText(value);

  if (label === undefined) {
    return valueText;
  }

  if (labelType === "key") {
    return `${JSON.stringify(label)}: ${valueText}`;
  }

  return `item ${label}: ${valueText}`;
}

function getJsonPathClipboardText(path: JsonPath) {
  if (!path.length) {
    return "$";
  }

  return path
    .map((segment, index) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }

      if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
        return index === 0 ? segment : `.${segment}`;
      }

      return `[${JSON.stringify(segment)}]`;
    })
    .join("");
}

function getHistoryPreview(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "空内容";
  }

  const firstLine = trimmed.split("\n")[0] ?? "";
  return firstLine.length > 38 ? `${firstLine.slice(0, 38)}...` : firstLine;
}

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(timestamp);
}

function getItemCountText(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function areSnapshotsEqual(
  left: JsonToolSnapshot | undefined,
  right: JsonToolSnapshot | undefined
) {
  return (
    left?.input === right?.input &&
    left?.indent === right?.indent &&
    left?.sortKeys === right?.sortKeys &&
    left?.viewMode === right?.viewMode
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  return Boolean(
    element?.closest("input, textarea, [contenteditable='true'], .cm-editor")
  );
}

export function getDocumentMetrics(text: string) {
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

export function getCursorMetrics(text: string, position: number) {
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

export function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

function normalizeJsonDisplayString(value: string) {
  return value.replace(/\r\n|\r|\n/g, ", ");
}

function areJsonPathsEqual(left: JsonPath | null | undefined, right: JsonPath | null | undefined) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((segment, index) => segment === right[index]);
}

function getJsonParentPath(path: JsonPath) {
  return path.slice(0, -1);
}

function areSameJsonParentPath(left: JsonPath, right: JsonPath) {
  return areJsonPathsEqual(getJsonParentPath(left), getJsonParentPath(right));
}

function canReorderJsonPath(sourcePath: JsonPath, targetPath: JsonPath) {
  return (
    sourcePath.length > 0 &&
    targetPath.length > 0 &&
    !areJsonPathsEqual(sourcePath, targetPath) &&
    areSameJsonParentPath(sourcePath, targetPath)
  );
}

function reorderJsonValue(
  root: unknown,
  sourcePath: JsonPath,
  targetPath: JsonPath,
  position: JsonDropPosition
) {
  if (!canReorderJsonPath(sourcePath, targetPath)) {
    return root;
  }

  const parentPath = getJsonParentPath(sourcePath);
  const sourceKey = sourcePath[sourcePath.length - 1];
  const targetKey = targetPath[targetPath.length - 1];

  const reorderParent = (parent: unknown) => {
    if (Array.isArray(parent)) {
      if (typeof sourceKey !== "number" || typeof targetKey !== "number") {
        return parent;
      }

      const next = [...parent];
      const [moved] = next.splice(sourceKey, 1);
      const targetIndexAfterRemoval =
        sourceKey < targetKey ? targetKey - 1 : targetKey;
      const insertIndex =
        position === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;

      next.splice(Math.max(0, Math.min(next.length, insertIndex)), 0, moved);
      return next;
    }

    if (typeof parent === "object" && parent !== null) {
      if (typeof sourceKey !== "string" || typeof targetKey !== "string") {
        return parent;
      }

      const entries = Object.entries(parent as Record<string, unknown>);
      const sourceIndex = entries.findIndex(([key]) => key === sourceKey);
      const targetIndex = entries.findIndex(([key]) => key === targetKey);

      if (sourceIndex < 0 || targetIndex < 0) {
        return parent;
      }

      const nextEntries = [...entries];
      const [moved] = nextEntries.splice(sourceIndex, 1);
      const targetIndexAfterRemoval =
        sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const insertIndex =
        position === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;

      nextEntries.splice(
        Math.max(0, Math.min(nextEntries.length, insertIndex)),
        0,
        moved
      );
      return Object.fromEntries(nextEntries);
    }

    return parent;
  };

  const updateAtPath = (value: unknown, path: JsonPath): unknown => {
    if (!path.length) {
      return reorderParent(value);
    }

    const [head, ...tail] = path;

    if (typeof head === "number") {
      if (!Array.isArray(value)) {
        return value;
      }

      return value.map((item, index) =>
        index === head ? updateAtPath(item, tail) : item
      );
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    return {
      ...(value as Record<string, unknown>),
      [head]: updateAtPath((value as Record<string, unknown>)[head], tail)
    };
  };

  return updateAtPath(root, parentPath);
}

export function findJsonPathPosition(source: string, path: JsonPath) {
  if (!path.length) {
    return 0;
  }

  const skipWhitespace = (index: number) => {
    let current = index;

    while (/\s/.test(source[current] ?? "")) {
      current += 1;
    }

    return current;
  };

  const readString = (index: number) => {
    let current = index + 1;
    let escaped = false;

    while (current < source.length) {
      const character = source[current];

      if (escaped) {
        escaped = false;
        current += 1;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        current += 1;
        continue;
      }

      if (character === "\"") {
        return {
          end: current + 1,
          value: JSON.parse(source.slice(index, current + 1)) as string
        };
      }

      current += 1;
    }

    return null;
  };

  const pathsEqual = (left: JsonPath, right: JsonPath) =>
    left.length === right.length &&
    left.every((segment, index) => segment === right[index]);

  const walkValue = (index: number, currentPath: JsonPath): { end: number; position?: number } => {
    const valueStart = skipWhitespace(index);
    const token = source[valueStart];

    if (pathsEqual(currentPath, path)) {
      return { end: valueStart, position: valueStart };
    }

    if (token === "{") {
      return walkObject(valueStart, currentPath);
    }

    if (token === "[") {
      return walkArray(valueStart, currentPath);
    }

    if (token === "\"") {
      const text = readString(valueStart);
      return { end: text?.end ?? valueStart + 1 };
    }

    const primitiveEnd = source.slice(valueStart).search(/[,\]}]/);
    return {
      end: primitiveEnd < 0 ? source.length : valueStart + primitiveEnd
    };
  };

  const walkObject = (index: number, currentPath: JsonPath): { end: number; position?: number } => {
    let current = skipWhitespace(index + 1);

    while (current < source.length && source[current] !== "}") {
      const keyStart = current;
      const key = readString(keyStart);

      if (!key) {
        return { end: current };
      }

      const childPath = [...currentPath, key.value];
      current = skipWhitespace(key.end);

      if (source[current] !== ":") {
        return { end: current };
      }

      if (pathsEqual(childPath, path)) {
        return { end: key.end, position: keyStart };
      }

      const child = walkValue(current + 1, childPath);

      if (child.position !== undefined) {
        return child;
      }

      current = skipWhitespace(child.end);

      if (source[current] === ",") {
        current = skipWhitespace(current + 1);
      }
    }

    return { end: current + 1 };
  };

  const walkArray = (index: number, currentPath: JsonPath): { end: number; position?: number } => {
    let current = skipWhitespace(index + 1);
    let itemIndex = 0;

    while (current < source.length && source[current] !== "]") {
      const child = walkValue(current, [...currentPath, itemIndex]);

      if (child.position !== undefined) {
        return child;
      }

      current = skipWhitespace(child.end);
      itemIndex += 1;

      if (source[current] === ",") {
        current = skipWhitespace(current + 1);
      }
    }

    return { end: current + 1 };
  };

  return walkValue(0, []).position ?? 0;
}

function getValueByPath(root: unknown, path: JsonPath) {
  return path.reduce<unknown>((current, segment) => {
    if (typeof segment === "number") {
      return Array.isArray(current) ? current[segment] : undefined;
    }

    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, root);
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

function parseEditedPrimitiveValue(rawValue: string, previousValue: unknown) {
  const trimmed = rawValue.trim();

  if (typeof previousValue === "string") {
    return rawValue;
  }

  if (trimmed === "null") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "") {
    throw new Error("值不能为空");
  }

  if (typeof previousValue === "number") {
    const parsedNumber = Number(trimmed);

    if (Number.isNaN(parsedNumber)) {
      throw new Error("请输入合法数字");
    }

    return parsedNumber;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("请输入合法值，字符串可直接输入，布尔值使用 true/false");
  }
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
    const escapedValue = JSON.stringify(normalizeJsonDisplayString(value)).slice(1, -1);
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

function JsonLine(props: JsonLineProps) {
  const {
    depth,
    showLineNumbers = true,
    className,
    children,
    actions,
    onSelect,
    selected = false,
    onDragOver,
    onDrop
  } = props;

  return (
    <div
      className={clsx(
        "json-line",
        className,
        showLineNumbers && "has-line-number",
        onSelect && "is-selectable",
        selected && "is-selected"
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(event) => {
        if (!onSelect) {
          return;
        }

        const target = event.target instanceof HTMLElement ? event.target : null;

        if (target?.closest("button, a, input")) {
          return;
        }

        onSelect();
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      {showLineNumbers ? <span className="json-line-number" aria-hidden="true" /> : null}
      <div
        className="json-line-content"
        style={{ paddingLeft: 10 + depth * 18 }}
      >
        <div className="json-line-body">{children}</div>
        {actions ? <div className="json-line-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

function EditableJsonPrimitive(props: {
  value: unknown;
  onCommit: (nextValue: unknown) => void;
}) {
  const { value, onCommit } = props;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (!editing) {
      setDraft(typeof value === "string" ? value : String(value));
    }
  }, [editing, value]);

  const commit = () => {
    try {
      onCommit(parseEditedPrimitiveValue(draft, value));
      setEditing(false);
    } catch {
      return;
    }
  };

  if (!editing) {
    return (
      <button
        className="json-inline-edit-trigger"
        onClick={() => {
          setDraft(typeof value === "string" ? value : String(value));
          setEditing(true);
        }}
        type="button"
      >
        <JsonPrimitive value={value} />
      </button>
    );
  }

  return (
    <span className="json-inline-edit">
      <input
        className="json-inline-input"
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }

          if (event.key === "Escape") {
            setEditing(false);
            setDraft(typeof value === "string" ? value : String(value));
          }
        }}
      />
    </span>
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
    childBatchSize,
    showLineNumbers = true,
    editable = false,
    onChange,
    path = [],
    onSelectPath,
    selectedPath,
    dragState,
    onDragStart,
    onDragOverPath,
    onDropPath,
    onDragEnd
  } = props;
  const nestedJson = React.useMemo(
    () => (typeof value === "string" ? resolveStringifiedJson(value) : null),
    [value]
  );
  const resolvedValue = nestedJson?.value ?? value;
  const isArray = Array.isArray(resolvedValue);
  const isObject =
    typeof resolvedValue === "object" && resolvedValue !== null && !isArray;
  const entries = isArray
    ? (resolvedValue as unknown[]).map((item, index) => [String(index), item] as const)
    : isObject
      ? Object.entries(resolvedValue as Record<string, unknown>)
      : [];
  const isExpandable = isArray || isObject;
  const [open, setOpen] = React.useState(depth < defaultExpandDepth);
  const batchSize = childBatchSize ?? Number.MAX_SAFE_INTEGER;
  const [visibleCount, setVisibleCount] = React.useState(
    Math.min(entries.length, batchSize)
  );
  const [showCopyPreview, setShowCopyPreview] = React.useState(false);
  const [copyPreviewMode, setCopyPreviewMode] = React.useState<JsonCopyMode>("object");
  const countText = getItemCountText(entries.length);

  React.useEffect(() => {
    setOpen(depth < defaultExpandDepth);
  }, [defaultExpandDepth, depth, resetToken]);

  React.useEffect(() => {
    setVisibleCount(Math.min(entries.length, batchSize));
  }, [batchSize, entries.length, resetToken]);

  const visibleEntries = entries.slice(0, visibleCount);
  const hiddenCount = Math.max(0, entries.length - visibleCount);
  const copyValue = nestedJson ? resolvedValue : value;
  const pathText = React.useMemo(() => getJsonPathClipboardText(path), [path]);
  const copyTexts = React.useMemo(
    () => ({
      property: pathText,
      value: toClipboardValueText(copyValue),
      object: getJsonPropertyClipboardText(label, labelType, copyValue)
    }),
    [copyValue, label, labelType, pathText]
  );
  const copyPreview = React.useMemo(() => {
    if (copyPreviewMode === "property") {
      return getCopyPreview(copyValue, "copy property", copyTexts.property);
    }

    if (copyPreviewMode === "value") {
      return getCopyPreview(copyValue, "复制value", copyTexts.value);
    }

    return getCopyPreview(copyValue, "复制对象", copyTexts.object);
  }, [copyPreviewMode, copyTexts.object, copyTexts.property, copyTexts.value, copyValue]);
  const selected = areJsonPathsEqual(path, selectedPath);
  const canDragNode = path.length > 0 && Boolean(onDragStart && onDropPath);
  const dropPosition = dragState?.target && areJsonPathsEqual(dragState.target.path, path)
    ? dragState.target.position
    : undefined;
  const selectCurrentPath = React.useCallback(() => {
    onSelectPath?.(path, copyValue);
  }, [copyValue, onSelectPath, path]);
  const handleDragOverLine = React.useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!dragState || !canReorderJsonPath(dragState.path, path)) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const position: JsonDropPosition =
        event.clientY < rect.top + rect.height / 2 ? "before" : "after";

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      onDragOverPath?.(path, position);
    },
    [dragState, onDragOverPath, path]
  );
  const handleDropLine = React.useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!dragState || !dropPosition || !canReorderJsonPath(dragState.path, path)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onDropPath?.(path, dropPosition);
    },
    [dragState, dropPosition, onDropPath, path]
  );
  const lineActions = (
    <span className="json-copy-action-wrap">
      {([
        ["property", "copy property"],
        ["value", "复制value"],
        ["object", "复制对象"]
      ] as const).map(([mode, text]) => (
        <button
          key={mode}
          className="json-node-action"
          onBlur={() => setShowCopyPreview(false)}
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard.writeText(copyTexts[mode]);
            setShowCopyPreview(false);
            event.currentTarget.blur();
          }}
          onFocus={() => {
            setCopyPreviewMode(mode);
            setShowCopyPreview(true);
          }}
          onMouseEnter={() => {
            setCopyPreviewMode(mode);
            setShowCopyPreview(true);
          }}
          onMouseLeave={() => setShowCopyPreview(false)}
          type="button"
          title={text}
        >
          <Copy size={13} />
          <span>{text}</span>
        </button>
      ))}
      {showCopyPreview ? (
        <span className="json-copy-preview" role="tooltip">
          <strong>{copyPreview.title}</strong>
          <span>{copyPreview.meta}</span>
          <code>{copyPreview.preview}</code>
        </span>
      ) : null}
    </span>
  );

  if (!isExpandable || entries.length === 0) {
    return (
      <div
        className={clsx("json-layer", "json-layer-leaf", showCopyPreview && "is-copy-target")}
      >
        <JsonLine
          depth={depth}
          showLineNumbers={showLineNumbers}
          className={clsx(dropPosition && `is-drop-${dropPosition}`)}
          actions={lineActions}
          onSelect={onSelectPath ? selectCurrentPath : undefined}
          selected={selected}
          onDragOver={handleDragOverLine}
          onDrop={handleDropLine}
        >
          {canDragNode ? (
            <span className="json-row-tools">
              <DragHandle
                onDragEnd={onDragEnd}
                onDragStart={(event: React.DragEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", pathText);
                  onDragStart?.(path);
                }}
              />
            </span>
          ) : (
            <span className="json-arrow-spacer" />
          )}
          {label !== undefined ? (
            <>
              {labelType === "key" ? (
                <span className="json-key">"{label}"</span>
              ) : (
                <span className="json-item-label">item {label}</span>
              )}
              <span className="json-punctuation json-label-separator">: </span>
            </>
          ) : null}
          {isExpandable ? (
            <span className="json-punctuation">{isArray ? "[]" : "{}"}</span>
          ) : editable && onChange ? (
            <EditableJsonPrimitive value={value} onCommit={onChange} />
          ) : (
            <JsonPrimitive value={value} />
          )}
          {!isLast ? <span className="json-punctuation">,</span> : null}
        </JsonLine>
      </div>
    );
  }

  const itemLabel = nestedJson
    ? `stringified ${nestedJson.kind}`
    : isArray
      ? "array"
      : "object";

  return (
    <div className={clsx("json-block", "json-layer", showCopyPreview && "is-copy-target")}>
      <JsonLine
        depth={depth}
        showLineNumbers={showLineNumbers}
        className={clsx(dropPosition && `is-drop-${dropPosition}`)}
        actions={lineActions}
        onSelect={onSelectPath ? selectCurrentPath : undefined}
        selected={selected}
        onDragOver={handleDragOverLine}
        onDrop={handleDropLine}
      >
        <span className="json-row-tools">
          {canDragNode ? (
            <DragHandle
              onDragEnd={onDragEnd}
              onDragStart={(event: React.DragEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", pathText);
                onDragStart?.(path);
              }}
            />
          ) : null}
          <button
            className="json-arrow"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </span>
        {label !== undefined ? (
          <>
            {labelType === "key" ? (
              <span className="json-key">"{label}"</span>
            ) : (
              <span className="json-item-label">item {label}</span>
            )}
            <span className="json-punctuation json-label-separator">: </span>
          </>
        ) : null}
        {nestedJson ? (
          <span className="json-stringified-chip">{itemLabel}</span>
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
      </JsonLine>

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
                showLineNumbers={showLineNumbers}
                editable={editable}
                path={[
                  ...path,
                  isArray ? Number(entryLabel) : entryLabel
                ]}
                onSelectPath={onSelectPath}
                selectedPath={selectedPath}
                dragState={dragState}
                onDragStart={onDragStart}
                onDragOverPath={onDragOverPath}
                onDropPath={onDropPath}
                onDragEnd={onDragEnd}
                onChange={
                  editable
                    ? (nextChildValue) => {
                        if (!onChange) {
                          return;
                        }

                        const wrapNextValue = (nextResolvedValue: unknown) => {
                          if (nestedJson) {
                            onChange(JSON.stringify(nextResolvedValue));
                            return;
                          }

                          onChange(nextResolvedValue);
                        };

                        if (isArray) {
                          const nextArray = [...(resolvedValue as unknown[])];
                          nextArray[Number(entryLabel)] = nextChildValue;
                          wrapNextValue(nextArray);
                          return;
                        }

                        wrapNextValue({
                          ...(resolvedValue as Record<string, unknown>),
                          [entryLabel]: nextChildValue
                        });
                      }
                    : undefined
                }
              />
            ))}
            {hiddenCount > 0 ? (
              <JsonLine
                depth={depth + 1}
                showLineNumbers={showLineNumbers}
                className="json-more-row"
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
              </JsonLine>
            ) : null}
          </div>
          <JsonLine depth={depth} showLineNumbers={showLineNumbers}>
            <span className="json-arrow-spacer" />
            <span className="json-punctuation">{isArray ? "]" : "}"}</span>
            {!isLast ? <span className="json-punctuation">,</span> : null}
          </JsonLine>
        </>
      ) : null}
    </div>
  );
}

function JsonViewer(props: JsonViewerProps) {
  const {
    value,
    defaultExpandDepth,
    resetToken,
    childBatchSize,
    showLineNumbers = true,
    editable = false,
    onChange,
    onSelectPath,
    selectedPath,
    dragState,
    onDragStart,
    onDragOverPath,
    onDropPath,
    onDragEnd
  } = props;

  return (
    <div className={clsx("json-viewer", showLineNumbers && "has-line-numbers")}>
      <JsonNode
        value={value}
        depth={0}
        isLast
        defaultExpandDepth={defaultExpandDepth}
        resetToken={resetToken}
        childBatchSize={childBatchSize}
        showLineNumbers={showLineNumbers}
        editable={editable}
        onChange={onChange}
        path={[]}
        onSelectPath={onSelectPath}
        selectedPath={selectedPath}
        dragState={dragState}
        onDragStart={onDragStart}
        onDragOverPath={onDragOverPath}
        onDropPath={onDropPath}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

export function JsonFormatTool({ inputId }: { inputId?: string }) {
  const [input, setInput] = React.useState(JSON_SAMPLE);
  const [error, setError] = React.useState<JsonLintError | null>(null);
  const [indent, setIndent] = React.useState("2");
  const [fontSize, setFontSize] = React.useState("13");
  const [sortKeys, setSortKeys] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>("pretty");
  const [inputView, setInputView] = React.useState<InputView>("edit");
  const [outputView, setOutputView] = React.useState<OutputView>("fold");
  const [showMoreTools, setShowMoreTools] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [cursorMetrics, setCursorMetrics] = React.useState({ line: 1, column: 1 });
  const [parseRevision, setParseRevision] = React.useState(0);
  const [historyEntries, setHistoryEntries] = React.useState<JsonHistoryEntry[]>([]);
  const [pathQuery, setPathQuery] = React.useState("");
  const [pathResult, setPathResult] = React.useState<PathQueryResult>({
    state: "idle",
    message: ""
  });
  const [selectedOutputPath, setSelectedOutputPath] = React.useState<JsonPath | null>(null);
  const [jsonDragState, setJsonDragState] = React.useState<JsonDragState | null>(null);
  const [treeDepth, setTreeDepth] = React.useState(2);
  const [parsedValue, setParsedValue] = React.useState<unknown>(
    JSON.parse(JSON_SAMPLE)
  );
  const [outputText, setOutputText] = React.useState(
    JSON.stringify(JSON.parse(JSON_SAMPLE), null, 2)
  );
  const [leftPaneWidth, setLeftPaneWidth] = React.useState(34);
  const inputEditorViewRef = React.useRef<EditorView | null>(null);
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{
    active: boolean;
  }>({ active: false });
  const undoStackRef = React.useRef<JsonToolSnapshot[]>([]);
  const redoStackRef = React.useRef<JsonToolSnapshot[]>([]);
  const [historyRevision, setHistoryRevision] = React.useState(0);

  const getSnapshot = React.useCallback(
    (): JsonToolSnapshot => ({
      input,
      indent,
      sortKeys,
      viewMode
    }),
    [indent, input, sortKeys, viewMode]
  );

  const restoreSnapshot = React.useCallback((snapshot: JsonToolSnapshot) => {
    setInput(snapshot.input);
    setIndent(snapshot.indent);
    setSortKeys(snapshot.sortKeys);
    setViewMode(snapshot.viewMode);
  }, []);

  const pushUndoSnapshot = React.useCallback((snapshot: JsonToolSnapshot) => {
    const stack = undoStackRef.current;
    const previous = stack[stack.length - 1];

    if (areSnapshotsEqual(previous, snapshot)) {
      return;
    }

    undoStackRef.current = [...stack, snapshot].slice(-MAX_UNDO_STACK_SIZE);
    redoStackRef.current = [];
    setHistoryRevision((current) => current + 1);
  }, []);

  const runUndoableChange = React.useCallback(
    (change: () => void) => {
      pushUndoSnapshot(getSnapshot());
      change();
    },
    [getSnapshot, pushUndoSnapshot]
  );

  const undoToolChange = React.useCallback(() => {
    const previous = undoStackRef.current.at(-1);

    if (!previous) {
      return;
    }

    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, getSnapshot()].slice(
      -MAX_UNDO_STACK_SIZE
    );
    restoreSnapshot(previous);
    setHistoryRevision((current) => current + 1);
  }, [getSnapshot, restoreSnapshot]);

  const redoToolChange = React.useCallback(() => {
    const next = redoStackRef.current.at(-1);

    if (!next) {
      return;
    }

    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, getSnapshot()].slice(
      -MAX_UNDO_STACK_SIZE
    );
    restoreSnapshot(next);
    setHistoryRevision((current) => current + 1);
  }, [getSnapshot, restoreSnapshot]);

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
    void getJsonHistory().then((entries) => {
      setHistoryEntries(entries);
    });
  }, []);

  React.useEffect(() => {
    if (!inputId) {
      return;
    }

    let cancelled = false;

    void consumePendingJsonInput(inputId).then((pendingInput) => {
      if (cancelled || !pendingInput) {
        return;
      }

      setInput(pendingInput.content);
      setInputView("edit");
      setOutputView("fold");
      undoStackRef.current = [];
      redoStackRef.current = [];
      setHistoryRevision((current) => current + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [inputId]);

  const saveHistoryEntries = React.useCallback((updater: (current: JsonHistoryEntry[]) => JsonHistoryEntry[]) => {
    setHistoryEntries((current) => {
      const next = updater(current);
      void setJsonHistory(next);
      return next;
    });
  }, []);

  const keepCurrentHistoryEntry = React.useCallback((content: string) => {
    const trimmed = content.trim();

    if (!trimmed) {
      return;
    }

    saveHistoryEntries((current) => {
      const deduped = current.filter((entry) => entry.content !== trimmed);
      const nextEntry: JsonHistoryEntry = {
        id: crypto.randomUUID(),
        content: trimmed,
        updatedAt: Date.now()
      };

      return [nextEntry, ...deduped].slice(0, MAX_JSON_HISTORY_ITEMS);
    });
  }, [saveHistoryEntries]);

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
        const nextOutput = JSON.stringify(normalized, null, space);
        setOutputText(nextOutput);
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

  const copyOutput = React.useCallback(async () => {
    if (!outputText) {
      return;
    }

    await navigator.clipboard.writeText(outputText);
  }, [outputText]);

  const jumpInputEditorToPath = React.useCallback(
    (path: JsonPath) => {
      setSelectedOutputPath(path);
      setInputView("edit");

      window.requestAnimationFrame(() => {
        const view = inputEditorViewRef.current;

        if (!view) {
          return;
        }

        try {
          const position = findJsonPathPosition(input, path);
          view.dispatch({
            selection: EditorSelection.cursor(position),
            effects: EditorView.scrollIntoView(position, {
              y: "center",
              x: "nearest"
            })
          });
          view.focus();
          setCursorMetrics(getCursorMetrics(view.state.doc.toString(), position));
        } catch {
          return;
        }
      });
    },
    [input]
  );

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isModifierPressed = event.metaKey || event.ctrlKey;

      if (!isModifierPressed) {
        return;
      }

      if (key === "s") {
        event.preventDefault();
        keepCurrentHistoryEntry(outputText);
        return;
      }

      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoToolChange();
        return;
      }

      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoToolChange();
      }
    };

    window.addEventListener("keydown", handleShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [
    keepCurrentHistoryEntry,
    outputText,
    redoToolChange,
    undoToolChange
  ]);

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
      runUndoableChange(() => setInput(nextValue));
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

  const setViewModeUndoable = React.useCallback(
    (nextViewMode: ViewMode) => {
      if (nextViewMode === viewMode) {
        return;
      }

      runUndoableChange(() => setViewMode(nextViewMode));
    },
    [runUndoableChange, viewMode]
  );

  const setIndentUndoable = React.useCallback(
    (nextIndent: string) => {
      if (nextIndent === indent) {
        return;
      }

      runUndoableChange(() => setIndent(nextIndent));
    },
    [indent, runUndoableChange]
  );

  const toggleSortUndoable = React.useCallback(() => {
    runUndoableChange(() => setSortKeys((current) => !current));
  }, [runUndoableChange]);

  const loadHistoryEntry = React.useCallback(
    (content: string) => {
      if (content === input) {
        return;
      }

      runUndoableChange(() => setInput(content));
    },
    [input, runUndoableChange]
  );

  const applyStructuredOutputChange = React.useCallback(
    (nextValue: unknown) => {
      try {
        const normalized = sortKeys ? sortJsonValue(nextValue) : nextValue;
        const space = viewMode === "pretty" ? Number(indent) || 2 : 0;
        setParsedValue(normalized);
        const nextOutput = JSON.stringify(normalized, null, space);
        setOutputText(nextOutput);
        runUndoableChange(() => setInput(nextOutput));
        setError(null);
        setParseRevision((current) => current + 1);
      } catch (changeError) {
        setError(buildJsonLintError(input, changeError));
      }
    },
    [indent, input, runUndoableChange, sortKeys, viewMode]
  );

  const applyJsonReorder = React.useCallback(
    (targetPath: JsonPath, position: JsonDropPosition) => {
      const sourcePath = jsonDragState?.path;

      if (!sourcePath || !canReorderJsonPath(sourcePath, targetPath)) {
        setJsonDragState(null);
        return;
      }

      try {
        const parsed = JSON.parse(input);
        const reordered = reorderJsonValue(parsed, sourcePath, targetPath, position);
        const normalized = sortKeys ? sortJsonValue(reordered) : reordered;
        const space = viewMode === "pretty" ? Number(indent) || 2 : 0;
        const nextOutput = JSON.stringify(normalized, null, space);

        setParsedValue(normalized);
        setOutputText(nextOutput);
        runUndoableChange(() => setInput(nextOutput));
        setSelectedOutputPath(targetPath);
        setError(null);
        setParseRevision((current) => current + 1);
      } catch (reorderError) {
        setError(buildJsonLintError(input, reorderError));
      } finally {
        setJsonDragState(null);
      }
    },
    [indent, input, jsonDragState?.path, runUndoableChange, sortKeys, viewMode]
  );

  const outputDepth = outputView === "text" || outputView === "flow" ? 99 : treeDepth;
  const treeResetToken = `${treeDepth}-${sortKeys}-${parseRevision}`;
  const outputResetToken = `${outputView}-${outputDepth}-${sortKeys}-${parseRevision}`;
  const editorFontSize = Math.max(12, Math.min(28, Number(fontSize) || 13));
  const isAllExpanded = outputView === "fold" && treeDepth >= 99;
  const canUndoToolChange = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedoToolChange = historyRevision >= 0 && redoStackRef.current.length > 0;
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

      <JsonHistoryDragProvider>
        <div className="tool-layout-with-history">
          <JsonHistorySidebar
            emptyText="点击“保留当前”后会出现在这里"
            entries={historyEntries}
            headAction={
              <button
                className="mini-switch"
                onClick={() => keepCurrentHistoryEntry(outputText)}
                type="button"
                disabled={Boolean(error) || !outputText.trim()}
              >
                保留当前
              </button>
            }
            onEntryClick={(entry) => setInput(entry.content)}
            onReorder={(sourceId, targetId, position) => {
              saveHistoryEntries((current) =>
                reorderJsonHistoryEntries(current, sourceId, targetId, position)
              );
            }}
            renderActions={(entry) => (
              <button
                className="mini-switch danger-switch"
                onClick={() => {
                  if (!window.confirm("确认删除这条记录？")) {
                    return;
                  }

                  saveHistoryEntries((current) =>
                    current.filter((item) => item.id !== entry.id)
                  );
                }}
                type="button"
              >
                <Trash2 size={14} />
                <span>删除</span>
              </button>
            )}
          />

          <div
            ref={splitContainerRef}
            className="resizable-workbench"
            style={
              {
                "--left-pane-width": `${leftPaneWidth}%`
              } as React.CSSProperties
            }
          >
        <JsonHistoryDropZone
          as="section"
          className={clsx("editor-panel", error && "is-error-panel")}
          onDropEntry={(entry) => {
            runUndoableChange(() => setInput(entry.content));
            setInputView("edit");
          }}
        >
          <div className="editor-panel-head">
            <div className="editor-panel-head-main">
              <span>
                行 {cursorMetrics.line} / 列 {cursorMetrics.column} · 共 {inputMetrics.lineCount} 行 · {formatBytes(inputMetrics.charCount)}
                {shouldUseLightweightInput ? " · 轻量模式" : ""}
              </span>
            </div>
            <div className="editor-panel-head-actions">
              <button
                className={clsx("mini-switch", inputView === "edit" && "is-active")}
                onClick={() => setInputView("edit")}
              >
                编辑
              </button>
              <button
                className={clsx("mini-switch", inputView === "fold" && "is-active")}
                onClick={() => setInputView("fold")}
              >
                结构
              </button>
            </div>
          </div>
          {inputView === "edit" ? (
            <div className="code-mirror-shell" style={{ fontSize: editorFontSize }}>
              <CodeMirror
                value={input}
                height="100%"
                extensions={inputEditorExtensions}
                onChange={handleInputEditorChange}
                onCreateEditor={(view) => {
                  inputEditorViewRef.current = view;
                }}
                basicSetup={{
                  foldGutter: true,
                  lineNumbers: true
                }}
              />
            </div>
          ) : (
            <div className="tree-panel" style={{ fontSize: editorFontSize }}>
              {isProcessing ? (
                <div className="json-loading-state">
                  <span className="spinner" />
                  <span>正在解析大体量 JSON...</span>
                </div>
              ) : !error ? (
                <div className="output-content">
                  <JsonViewer
                    value={parsedValue}
                    defaultExpandDepth={treeDepth}
                    resetToken={`input-${treeResetToken}`}
                    childBatchSize={shouldUseLightweightInput ? TREE_CHILD_BATCH_SIZE : undefined}
                    showLineNumbers
                    dragState={jsonDragState}
                    onDragStart={(path) => setJsonDragState({ path })}
                    onDragOverPath={(path, position) =>
                      setJsonDragState((current) =>
                        current ? { ...current, target: { path, position } } : current
                      )
                    }
                    onDropPath={applyJsonReorder}
                    onDragEnd={() => setJsonDragState(null)}
                  />
                </div>
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
          )}
        </JsonHistoryDropZone>

        <div
          className="splitter"
          onPointerDown={(event) => {
            event.preventDefault();
            dragStateRef.current.active = true;
          }}
        >
          <GripVertical size={14} />
        </div>

        <JsonHistoryDropZone
          as="section"
          className={clsx("editor-panel", error && "is-error-panel")}
          onDropEntry={(entry) => {
            runUndoableChange(() => setInput(entry.content));
            setOutputView("fold");
          }}
        >
          <div className="editor-panel-head">
            <div className="editor-panel-head-main">
              <span>
                {isProcessing
                  ? "处理中..."
                  : `共 ${outputMetrics.lineCount} 行 · ${formatBytes(outputMetrics.charCount)}`}
                {shouldUseLightweightOutput ? " · 轻量模式" : ""}
              </span>
            </div>
            <div className="editor-panel-head-actions">
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
                结构
              </button>
              <button
                className={clsx("mini-switch", outputView === "flow" && "is-active")}
                onClick={() => setOutputView("flow")}
              >
                拖拽
              </button>
              <button
                className={clsx("mini-switch", outputView === "fold" && "is-active")}
                onClick={toggleExpandAll}
              >
                {isAllExpanded ? "全部折叠" : "全部展开"}
              </button>
            </div>
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
              ) : outputView === "flow" ? (
                <React.Suspense
                  fallback={
                    <div className="json-loading-state output-content">
                      <span className="spinner" />
                      <span>正在加载拖拽视图...</span>
                    </div>
                  }
                >
                  <JsonFlowViewer
                    value={parsedValue}
                    onSelectPath={(path) => jumpInputEditorToPath(path)}
                  />
                </React.Suspense>
              ) : (
                <div className="output-content">
                  <JsonViewer
                    value={parsedValue}
                    defaultExpandDepth={outputDepth}
                    resetToken={outputResetToken}
                    childBatchSize={shouldUseLightweightOutput ? TREE_CHILD_BATCH_SIZE : undefined}
                    showLineNumbers
                    editable
                    onChange={applyStructuredOutputChange}
                    onSelectPath={(path) => jumpInputEditorToPath(path)}
                    selectedPath={selectedOutputPath}
                    dragState={jsonDragState}
                    onDragStart={(path) => setJsonDragState({ path })}
                    onDragOverPath={(path, position) =>
                      setJsonDragState((current) =>
                        current ? { ...current, target: { path, position } } : current
                      )
                    }
                    onDropPath={applyJsonReorder}
                    onDragEnd={() => setJsonDragState(null)}
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
        </JsonHistoryDropZone>
        </div>
      </div>
      </JsonHistoryDragProvider>
    </div>
  );
}
