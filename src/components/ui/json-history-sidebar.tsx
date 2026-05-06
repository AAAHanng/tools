import clsx from "clsx";
import React from "react";
import type { JsonHistoryEntry } from "@/shared/storage";
import { DragHandle } from "@/components/ui/drag-handle";

export type JsonHistoryReorderPosition = "before" | "after";

type JsonHistoryDragContextValue = {
  activeEntry: JsonHistoryEntry | null;
  setActiveEntry: (entry: JsonHistoryEntry | null) => void;
  clearDrag: () => void;
};

type JsonHistoryDragProviderProps = {
  children: React.ReactNode;
};

type JsonHistorySidebarProps = {
  className?: string;
  emptyText: string;
  entries: JsonHistoryEntry[];
  headAction?: React.ReactNode;
  onEntryClick?: (entry: JsonHistoryEntry) => void;
  onReorder?: (
    sourceId: string,
    targetId: string,
    position: JsonHistoryReorderPosition
  ) => void;
  renderActions?: (entry: JsonHistoryEntry) => React.ReactNode;
  title?: string;
};

type JsonHistoryDropZoneProps = {
  as?: "div" | "section";
  children: React.ReactNode;
  className?: string;
  onDropEntry: (entry: JsonHistoryEntry) => void;
};

type ReorderTarget = {
  entryId: string;
  position: JsonHistoryReorderPosition;
};

const JsonHistoryDragContext = React.createContext<JsonHistoryDragContextValue | null>(
  null
);

function useJsonHistoryDragContext() {
  const context = React.useContext(JsonHistoryDragContext);

  if (!context) {
    throw new Error("JsonHistory drag context is missing.");
  }

  return context;
}

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(timestamp);
}

export function reorderJsonHistoryEntries(
  entries: JsonHistoryEntry[],
  sourceId: string,
  targetId: string,
  position: JsonHistoryReorderPosition
) {
  if (sourceId === targetId) {
    return entries;
  }

  const sourceIndex = entries.findIndex((entry) => entry.id === sourceId);
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return entries;
  }

  const nextEntries = [...entries];
  const [movedEntry] = nextEntries.splice(sourceIndex, 1);
  const adjustedTargetIndex =
    sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex =
    position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;

  nextEntries.splice(insertIndex, 0, movedEntry);
  return nextEntries;
}

export function JsonHistoryDragProvider(props: JsonHistoryDragProviderProps) {
  const { children } = props;
  const [activeEntry, setActiveEntry] = React.useState<JsonHistoryEntry | null>(null);

  const contextValue = React.useMemo(
    () => ({
      activeEntry,
      setActiveEntry,
      clearDrag: () => setActiveEntry(null)
    }),
    [activeEntry]
  );

  return (
    <JsonHistoryDragContext.Provider value={contextValue}>
      {children}
    </JsonHistoryDragContext.Provider>
  );
}

export function JsonHistoryDropZone(props: JsonHistoryDropZoneProps) {
  const { as = "div", children, className, onDropEntry } = props;
  const { activeEntry, clearDrag } = useJsonHistoryDragContext();
  const [isOver, setIsOver] = React.useState(false);
  const dragDepthRef = React.useRef(0);
  const Component = as;

  return (
    <Component
      className={clsx(className, "history-drop-zone", isOver && "is-active")}
      onDragEnter={(event: React.DragEvent<HTMLElement>) => {
        if (!activeEntry) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current += 1;
        setIsOver(true);
      }}
      onDragLeave={() => {
        if (!activeEntry) {
          return;
        }

        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

        if (dragDepthRef.current === 0) {
          setIsOver(false);
        }
      }}
      onDragOver={(event: React.DragEvent<HTMLElement>) => {
        if (!activeEntry) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsOver(true);
      }}
      onDrop={(event: React.DragEvent<HTMLElement>) => {
        if (!activeEntry) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current = 0;
        setIsOver(false);
        onDropEntry(activeEntry);
        clearDrag();
      }}
    >
      {children}
      {isOver ? (
        <div className="history-drop-overlay" aria-hidden="true">
          <span>放下写入</span>
        </div>
      ) : null}
    </Component>
  );
}

export function JsonHistorySidebar(props: JsonHistorySidebarProps) {
  const {
    className,
    emptyText,
    entries,
    headAction,
    onEntryClick,
    onReorder,
    renderActions,
    title
  } = props;
  const { activeEntry, clearDrag, setActiveEntry } = useJsonHistoryDragContext();
  const [reorderTarget, setReorderTarget] = React.useState<ReorderTarget | null>(null);

  React.useEffect(() => {
    if (!activeEntry) {
      setReorderTarget(null);
    }
  }, [activeEntry]);

  return (
    <aside className={clsx("history-sidebar", className)}>
      <div className="history-sidebar-head">
        <div className="history-sidebar-head-copy">
          {title ? <strong>{title}</strong> : null}
          <span>{entries.length} 条</span>
        </div>
        {headAction}
      </div>
      <div className="history-list">
        {entries.length ? (
          entries.map((entry) => {
            const isSource = activeEntry?.id === entry.id;
            const isDropBefore =
              reorderTarget?.entryId === entry.id &&
              reorderTarget.position === "before";
            const isDropAfter =
              reorderTarget?.entryId === entry.id &&
              reorderTarget.position === "after";

            return (
              <div
                key={entry.id}
                className={clsx(
                  "history-item",
                  isSource && "is-drag-source",
                  isDropBefore && "is-drop-before",
                  isDropAfter && "is-drop-after"
                )}
                onDragOver={(event) => {
                  if (!activeEntry || activeEntry.id === entry.id || !onReorder) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";

                  const rect = event.currentTarget.getBoundingClientRect();
                  const nextPosition: JsonHistoryReorderPosition =
                    event.clientY < rect.top + rect.height / 2 ? "before" : "after";

                  setReorderTarget({
                    entryId: entry.id,
                    position: nextPosition
                  });
                }}
                onDrop={(event) => {
                  if (
                    !activeEntry ||
                    activeEntry.id === entry.id ||
                    !onReorder ||
                    !reorderTarget ||
                    reorderTarget.entryId !== entry.id
                  ) {
                    return;
                  }

                  event.preventDefault();
                  onReorder(activeEntry.id, entry.id, reorderTarget.position);
                  setReorderTarget(null);
                  clearDrag();
                }}
              >
                <div className="history-item-head">
                  {onEntryClick ? (
                    <button
                      className="history-item-main"
                      onClick={() => onEntryClick(entry)}
                      type="button"
                    >
                      <strong>{formatHistoryTime(entry.updatedAt)}</strong>
                      <span className="history-item-meta">{entry.content.length} chars</span>
                    </button>
                  ) : (
                    <div className="history-item-main">
                      <strong>{formatHistoryTime(entry.updatedAt)}</strong>
                      <span className="history-item-meta">{entry.content.length} chars</span>
                    </div>
                  )}
                  <DragHandle
                    title="拖拽记录"
                    onDragEnd={() => {
                      setReorderTarget(null);
                      clearDrag();
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copyMove";
                      event.dataTransfer.setData("text/plain", entry.id);
                      setActiveEntry(entry);
                    }}
                  />
                </div>
                {renderActions ? (
                  <div className="history-item-actions">{renderActions(entry)}</div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="history-empty">{emptyText}</div>
        )}
      </div>
    </aside>
  );
}
