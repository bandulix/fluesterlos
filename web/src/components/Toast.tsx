import { useEffect } from "react";

export type ToastMessage = { id: number; text: string };

/** Small transient confirmation (bottom of the screen); auto-hides. */
export function Toast({ toast, onDone, ms = 2500 }: { toast: ToastMessage | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [toast, onDone, ms]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id}>
      {toast.text}
    </div>
  );
}
