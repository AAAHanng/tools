import React from "react";

type DiffItem = {
  path: string;
  left: string;
  right: string;
};

function compareJson(left: unknown, right: unknown, basePath = "$"): DiffItem[] {
  if (Object.is(left, right)) {
    return [];
  }

  const leftIsObject = typeof left === "object" && left !== null;
  const rightIsObject = typeof right === "object" && right !== null;

  if (!leftIsObject || !rightIsObject) {
    return [
      {
        path: basePath,
        left: JSON.stringify(left),
        right: JSON.stringify(right)
      }
    ];
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    const max = Math.max(
      Array.isArray(left) ? left.length : 0,
      Array.isArray(right) ? right.length : 0
    );
    const diffs: DiffItem[] = [];

    for (let index = 0; index < max; index += 1) {
      diffs.push(
        ...compareJson(
          (left as unknown[])[index],
          (right as unknown[])[index],
          `${basePath}[${index}]`
        )
      );
    }

    return diffs;
  }

  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>)
  ]);

  const diffs: DiffItem[] = [];
  for (const key of keys) {
    diffs.push(
      ...compareJson(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${basePath}.${key}`
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

export function JsonDiffTool() {
  const [leftInput, setLeftInput] = React.useState(LEFT_SAMPLE);
  const [rightInput, setRightInput] = React.useState(RIGHT_SAMPLE);
  const [error, setError] = React.useState<string>("");
  const [diffs, setDiffs] = React.useState<DiffItem[]>([]);

  const runDiff = () => {
    try {
      const left = JSON.parse(leftInput);
      const right = JSON.parse(rightInput);
      const nextDiffs = compareJson(left, right);
      setDiffs(nextDiffs);
      setError("");
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : "JSON parse failed");
      setDiffs([]);
    }
  };

  return (
    <div className="tool-workbench">
      <div className="workbench-toolbar">
        <div className="toolbar-group">
          <span className="toolbar-title">JSON 对比</span>
          <span className="toolbar-subtitle">左右输入，底部列出差异</span>
        </div>
        <div className="toolbar-actions">
          <button className="primary-button" onClick={runDiff}>
            开始对比
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="workbench-grid split-two">
        <section className="editor-panel">
          <div className="editor-panel-head">
            <strong>左侧 JSON</strong>
            <span>基准输入</span>
          </div>
          <textarea
            className="workspace-textarea"
            value={leftInput}
            onChange={(event) => setLeftInput(event.target.value)}
          />
        </section>

        <section className="editor-panel">
          <div className="editor-panel-head">
            <strong>右侧 JSON</strong>
            <span>对比输入</span>
          </div>
          <textarea
            className="workspace-textarea"
            value={rightInput}
            onChange={(event) => setRightInput(event.target.value)}
          />
        </section>
      </div>

      <section className="result-panel">
        <div className="editor-panel-head">
          <strong>差异列表</strong>
          <span>{diffs.length} differences</span>
        </div>
        <div className="result-stack">
          {diffs.length === 0 && !error ? (
            <div className="info-box">当前没有差异，或者还没有执行对比。</div>
          ) : null}
          {diffs.map((item) => (
            <div key={`${item.path}-${item.left}-${item.right}`} className="diff-row">
              <strong>{item.path}</strong>
              <span>left: {item.left}</span>
              <span>right: {item.right}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
