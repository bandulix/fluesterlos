import { useLayoutEffect, useRef } from "react";

const VAR = "--g-bottom-bar";
const active = new Map<symbol, number>();

function apply() {
  const max = Math.max(0, ...active.values());
  const root = document.documentElement;
  if (max > 0) root.style.setProperty(VAR, `${Math.ceil(max)}px`);
  else root.style.removeProperty(VAR);
}

/**
 * A fixed bottom bar (install hint, name sheet) reserves its real height — plus its offset from
 * the bottom edge — as page bottom padding (`--g-bottom-bar`), so the last card can always be
 * scrolled clear of it, whatever the bar's text wraps to on a given phone.
 */
export function useBottomBarSpace<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const key = Symbol("bottom-bar");
    const measure = () => {
      const r = el.getBoundingClientRect();
      active.set(key, Math.max(0, window.innerHeight - r.top) + 16);
      apply();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      active.delete(key);
      apply();
    };
  }, []);
  return ref;
}
