import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import React from "react";
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
import {
  baseJsonEditorExtensions,
  findJsonPathPosition,
  formatBytes,
  getDocumentMetrics,
  type JsonPath
} from "@/features/tools/json-format-tool";

type DiffItem = {
  path: string;
  pathSegments: JsonPath;
  left: string;
  right: string;
  type: "changed" | "added" | "removed";
};

type DiffSide = "left" | "right";

type ParseState = {
  left?: unknown;
  right?: unknown;
  error: string;
};

const REALTIME_DIFF_DELAY = 800;
const MISSING_VALUE = Symbol("missing-json-value");

function isMissingValue(value: unknown): value is typeof MISSING_VALUE {
  return value === MISSING_VALUE;
}

function isObjectLike(value: unknown) {
  return typeof value === "object" && value !== null;
}

function getJsonPathText(path: JsonPath) {
  if (!path.length) {
    return "$";
  }

  return `$${path
    .map((segment) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }

      if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
        return `.${segment}`;
      }

      return `[${JSON.stringify(segment)}]`;
    })
    .join("")}`;
}

function stringifyDiffValue(value: unknown) {
  if (isMissingValue(value)) {
    return "(不存在)";
  }

  return JSON.stringify(value, null, 2);
}

function getDiffType(left: unknown, right: unknown): DiffItem["type"] {
  if (isMissingValue(left)) {
    return "added";
  }

  if (isMissingValue(right)) {
    return "removed";
  }

  return "changed";
}

function compareJson(
  left: unknown,
  right: unknown,
  pathSegments: JsonPath = []
): DiffItem[] {
  if (Object.is(left, right)) {
    return [];
  }

  const leftIsMissing = isMissingValue(left);
  const rightIsMissing = isMissingValue(right);
  const leftIsObject = isObjectLike(left);
  const rightIsObject = isObjectLike(right);

  if (leftIsMissing || rightIsMissing || !leftIsObject || !rightIsObject) {
    return [
      {
        path: getJsonPathText(pathSegments),
        pathSegments,
        left: stringifyDiffValue(left),
        right: stringifyDiffValue(right),
        type: getDiffType(left, right)
      }
    ];
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return [
        {
          path: getJsonPathText(pathSegments),
          pathSegments,
          left: stringifyDiffValue(left),
          right: stringifyDiffValue(right),
          type: "changed"
        }
      ];
    }

    const max = Math.max(
      left.length,
      right.length
    );
    const diffs: DiffItem[] = [];

    for (let index = 0; index < max; index += 1) {
      const leftValue = index in left ? left[index] : MISSING_VALUE;
      const rightValue = index in right ? right[index] : MISSING_VALUE;

      diffs.push(
        ...compareJson(
          leftValue,
          rightValue,
          [...pathSegments, index]
        )
      );
    }

    return diffs;
  }

  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>)
  ]);
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;

  const diffs: DiffItem[] = [];
  for (const key of keys) {
    const leftValue = Object.hasOwn(leftObject, key) ? leftObject[key] : MISSING_VALUE;
    const rightValue = Object.hasOwn(rightObject, key) ? rightObject[key] : MISSING_VALUE;

    diffs.push(
      ...compareJson(
        leftValue,
        rightValue,
        [...pathSegments, key]
      )
    );
  }

  return diffs;
}

const LEFT_SAMPLE = `{
  "name": "alpha",
  "enabled": true,
  "count": 2,
  "items": ["a", "b"]
}`;

const RIGHT_SAMPLE = `{
  "name": "beta",
  "enabled": false,
  "count": 3,
  "items": ["a", "c"]
}`;

function formatInput(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function getParseState(leftInput: string, rightInput: string): ParseState {
  try {
    const left = JSON.parse(leftInput);
    const right = JSON.parse(rightInput);

    return {
      left,
      right,
      error: ""
    };
  } catch (diffError) {
    return {
      error: diffError instanceof Error ? diffError.message : "JSON parse failed"
    };
  }
}

function getDiffTypeLabel(type: DiffItem["type"]) {
  switch (type) {
    case "added":
      return "右侧新增";
    case "removed":
      return "右侧缺失";
    default:
      return "值不同";
  }
}

function getSideMetrics(text: string) {
  const metrics = getDocumentMetrics(text);
  return `共 ${metrics.lineCount} 行 · ${formatBytes(metrics.charCount)}`;
}

export function JsonDiffTool({ inputId }: { inputId?: string }) {
  const [leftInput, setLeftInput] = React.useState(LEFT_SAMPLE);
  const [rightInput, setRightInput] = React.useState(RIGHT_SAMPLE);
  const [error, setError] = React.useState<string>("");
  const [diffs, setDiffs] = React.useState<DiffItem[]>([]);
  const [isComparing, setIsComparing] = React.useState(false);
  const [activeDiffKey, setActiveDiffKey] = React.useState("");
  const [historyEntries, setHistoryEntries] = React.useState<JsonHistoryEntry[]>([]);
  const leftEditorViewRef = React.useRef<EditorView | null>(null);
  const rightEditorViewRef = React.useRef<EditorView | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void getJsonHistory().then((entries) => {
      if (!cancelled) {
        setHistoryEntries(entries);
      }
    });

    return () => {
      cancelled = true;
    };
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

      setLeftInput(pendingInput.content);
    });

    return () => {
      cancelled = true;
    };
  }, [inputId]);

  React.useEffect(() => {
    let cancelled = false;
    setIsComparing(true);

    const scheduleId = window.setTimeout(() => {
      const parseState = getParseState(leftInput, rightInput);

      if (cancelled) {
        return;
      }

      if (parseState.error) {
        setError(parseState.error);
        setDiffs([]);
        setActiveDiffKey("");
        setIsComparing(false);
        return;
      }

      const nextDiffs = compareJson(parseState.left, parseState.right);
      setDiffs(nextDiffs);
      setError("");
      setActiveDiffKey((current) =>
        nextDiffs.some((item) => getDiffKey(item) === current) ? current : ""
      );
      setIsComparing(false);
    }, REALTIME_DIFF_DELAY);

    return () => {
      cancelled = true;
      window.clearTimeout(scheduleId);
    };
  }, [leftInput, rightInput]);

  const saveHistoryEntries = React.useCallback(
    (updater: (current: JsonHistoryEntry[]) => JsonHistoryEntry[]) => {
      setHistoryEntries((current) => {
        const next = updater(current);
        void setJsonHistory(next);
        return next;
      });
    },
    []
  );

  const leftMetrics = React.useMemo(() => getSideMetrics(leftInput), [leftInput]);
  const rightMetrics = React.useMemo(() => getSideMetrics(rightInput), [rightInput]);
  const editorExtensions = React.useMemo(() => baseJsonEditorExtensions, []);

  const jumpEditorToPath = React.useCallback(
    (side: DiffSide, path: JsonPath) => {
      const view = side === "left" ? leftEditorViewRef.current : rightEditorViewRef.current;
      const source = side === "left" ? leftInput : rightInput;

      if (!view) {
        return;
      }

      window.requestAnimationFrame(() => {
        try {
          const position = findJsonPathPosition(source, path);
          view.dispatch({
            selection: EditorSelection.cursor(position),
            effects: EditorView.scrollIntoView(position, {
              y: "center",
              x: "nearest"
            })
          });
          view.focus();
        } catch {
          return;
        }
      });
    },
    [leftInput, rightInput]
  );

  const jumpToDiff = React.useCallback(
    (item: DiffItem) => {
      setActiveDiffKey(getDiffKey(item));

      if (item.type !== "added") {
        jumpEditorToPath("left", item.pathSegments);
      }

      if (item.type !== "removed") {
        jumpEditorToPath("right", item.pathSegments);
      }
    },
    [jumpEditorToPath]
  );

  const formatBothInputs = React.useCallback(() => {
    setLeftInput((current) => formatInput(current));
    setRightInput((current) => formatInput(current));
  }, []);

  const copyLeftToRight = React.useCallback(() => {
    setRightInput(leftInput);
  }, [leftInput]);

  return (
    <div className="tool-workbench no-gap-top">
      <div className="workbench-toolbar single-line-toolbar">
        <button className="mini-switch" onClick={formatBothInputs} type="button">
          格式化
        </button>
        <button className="mini-switch" onClick={copyLeftToRight} type="button">
          贡献左侧数据
        </button>
        <span className="toolbar-subtitle">
          {isComparing ? "实时对比中..." : `实时对比 · ${diffs.length} 处差异`}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <JsonHistoryDragProvider>
        <div className="tool-layout-with-history json-diff-layout">
          <JsonHistorySidebar
            className="diff-history-sidebar"
            emptyText="JSON 美化里点击“保留当前”后会出现在这里"
            entries={historyEntries}
            onReorder={(sourceId, targetId, position) => {
              saveHistoryEntries((current) =>
                reorderJsonHistoryEntries(current, sourceId, targetId, position)
              );
            }}
            renderActions={(entry) => (
              <>
                <button
                  className="mini-switch"
                  onClick={() => setLeftInput(entry.content)}
                  type="button"
                >
                  填左侧
                </button>
                <button
                  className="mini-switch"
                  onClick={() => setRightInput(entry.content)}
                  type="button"
                >
                  填右侧
                </button>
              </>
            )}
            title="保留记录"
          />

          <div className="diff-main-stack">
          <div className="workbench-grid split-two diff-editor-grid">
            <JsonHistoryDropZone
              as="section"
              className="editor-panel"
              onDropEntry={(entry) => setLeftInput(entry.content)}
            >
              <div className="editor-panel-head">
                <div className="editor-panel-head-main">
                  <strong>左侧 JSON</strong>
                  <span>基准输入 · {leftMetrics}</span>
                </div>
              </div>
              <div className="code-mirror-shell diff-editor-shell">
                <CodeMirror
                  value={leftInput}
                  height="100%"
                  extensions={editorExtensions}
                  onChange={setLeftInput}
                  onCreateEditor={(view) => {
                    leftEditorViewRef.current = view;
                  }}
                  basicSetup={{
                    foldGutter: true,
                    lineNumbers: true
                  }}
                />
              </div>
            </JsonHistoryDropZone>

            <JsonHistoryDropZone
              as="section"
              className="editor-panel"
              onDropEntry={(entry) => setRightInput(entry.content)}
            >
              <div className="editor-panel-head">
                <div className="editor-panel-head-main">
                  <strong>右侧 JSON</strong>
                  <span>对比输入 · {rightMetrics}</span>
                </div>
              </div>
              <div className="code-mirror-shell diff-editor-shell">
                <CodeMirror
                  value={rightInput}
                  height="100%"
                  extensions={editorExtensions}
                  onChange={setRightInput}
                  onCreateEditor={(view) => {
                    rightEditorViewRef.current = view;
                  }}
                  basicSetup={{
                    foldGutter: true,
                    lineNumbers: true
                  }}
                />
              </div>
            </JsonHistoryDropZone>
          </div>

          <section className="result-panel">
            <div className="editor-panel-head">
              <strong>差异列表</strong>
              <span>{isComparing ? "更新中..." : `${diffs.length} differences`}</span>
            </div>
            <div className="result-stack">
              {diffs.length === 0 && !error ? (
                <div className="info-box">
                  {isComparing ? "正在等待输入稳定..." : "当前没有差异。"}
                </div>
              ) : null}
              {diffs.map((item) => (
                <button
                  key={getDiffKey(item)}
                  className={`diff-row diff-row-button is-${item.type}${
                    activeDiffKey === getDiffKey(item) ? " is-active" : ""
                  }`}
                  onClick={() => jumpToDiff(item)}
                  type="button"
                >
                  <span className="diff-row-head">
                    <strong>{item.path}</strong>
                    <span>{getDiffTypeLabel(item.type)}</span>
                  </span>
                  <span className="diff-values">
                    <code>left: {item.left}</code>
                    <code>right: {item.right}</code>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
      </JsonHistoryDragProvider>
    </div>
  );
}

function getDiffKey(item: DiffItem) {
  return `${item.path}-${item.left}-${item.right}-${item.type}`;
}
