import { useEffect, useRef, useState } from "react";
import { chipScrollEdges, FilterKey, filtersFor } from "../lib/bidLogic";
import { t } from "../i18n";

/**
 * One horizontal row. Labels that do not fit at 390px scroll instead of wrapping.
 * After the close the set becomes All / Won / Not won.
 */
export function FilterChips({
  value,
  counts,
  closed = false,
  onChange,
}: {
  value: FilterKey;
  counts: Record<FilterKey, number>;
  closed?: boolean;
  onChange: (f: FilterKey) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setEdges(chipScrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [value, counts, closed]);
  const fade = `${edges.left ? " is-left" : ""}${edges.right ? " is-right" : ""}`;
  return (
    <div className={`g-chips-wrap${fade}`}>
    <div className="g-chips" role="tablist" aria-label={t("bid.filter.label")} ref={scroller}>
      {filtersFor(closed).map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={value === f}
          className={`g-chip g-chip-${closed && f === "outbid" ? "lost" : f}${value === f ? " is-active" : ""}`}
          onClick={() => onChange(f)}
        >
          {t(closed && f !== "all" ? (`bid.filter.closed.${f}` as const) : (`bid.filter.${f}` as const))}
          {f !== "all" && counts[f] > 0 && <span className="g-chip-count">{counts[f]}</span>}
        </button>
      ))}
    </div>
    </div>
  );
}
