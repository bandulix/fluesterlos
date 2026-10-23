import { useEffect, useRef, useState } from "react";

export type ToastMessage = {
  id: number;
  text: string;
  /** Optional inline action (e.g. "Undo" right after a bid). */
  action?: { label: string; onClick: () => void };
  /** Per-toast duration; overrides the component default. */
  ms?: number;
};

/**
 * Small transient confirmation (bottom of the screen); auto-hides.
 *
 * The timer belongs to one toast (keyed by `toast.id`): re-renders, live updates or a new `onDone`
 * function never restart or cut it short. It pauses while the page is hidden (phone locked, app
 * switched) and while the pointer rests on the toast, so an Undo window is never lost unseen.
 */
export function Toast({ toast, onDone, ms = 2500 }: { toast: ToastMessage | null; onDone: () => void; ms?: number }) {
  const duration = toast?.ms ?? ms;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const remaining = useRef(duration);
  const id = toast?.id;

  // New toast → full duration.
  useEffect(() => {
    remaining.current = duration;
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const running = id != null && !paused && !hidden;
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setTimeout(() => onDoneRef.current(), Math.max(0, remaining.current));
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - started;
    };
  }, [running, id]);

  if (!toast) return null;
  return (
    <div
      className={`toast${toast.action ? " has-action" : ""}${running ? "" : " is-paused"}`}
      role="status"
      aria-live="polite"
      key={toast.id}
      data-toast-ms={duration}
      onPointerEnter={(e) => e.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <span className="toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.action && <span key={toast.id} className="toast-timer" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />}
    </div>
  );
}
