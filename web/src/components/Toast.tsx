import { useEffect } from "react";

export type ToastMessage = {
  id: number;
  text: string;
  /** Optional inline action (e.g. "Undo" right after a bid). */
  action?: { label: string; onClick: () => void };
  /** Per-toast duration; overrides the component default. */
  ms?: number;
};

/** Small transient confirmation (bottom of the screen); auto-hides. */
export function Toast({ toast, onDone, ms = 2500 }: { toast: ToastMessage | null; onDone: () => void; ms?: number }) {
  const duration = toast?.ms ?? ms;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [toast, onDone, duration]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.action ? " has-action" : ""}`} role="status" aria-live="polite" key={toast.id}>
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
      {toast.action && <span className="toast-timer" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />}
    </div>
  );
}
