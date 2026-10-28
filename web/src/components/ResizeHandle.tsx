import { useRef, useState } from "react";
export default function ResizeHandle({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      data-dragging={dragging}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start.current = { x: event.clientX, width: value };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (start.current)
          onChange(start.current.width + event.clientX - start.current.x);
      }}
      onPointerUp={(event) => {
        start.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        start.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        if (delta || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onChange(
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : value + delta
          );
        }
      }}
    />
  );
}
