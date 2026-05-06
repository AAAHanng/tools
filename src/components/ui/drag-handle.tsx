import React from "react";

type DragHandleProps = {
  disabled?: boolean;
  title?: string;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLButtonElement>) => void;
};

export function DragHandle(props: DragHandleProps) {
  const { disabled = false, title = "拖拽排序", onDragStart, onDragEnd } = props;

  return (
    <button
      aria-label={title}
      className="drag-handle"
      draggable={!disabled}
      onClick={(event) => event.stopPropagation()}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      title={title}
      type="button"
    >
      <span />
      <span />
      <span />
      <span />
    </button>
  );
}
