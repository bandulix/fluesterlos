import { FilterKey, filtersFor } from "../lib/bidLogic";
import { t } from "../i18n";

/**
 * Compact chips that always fit a 360–390px phone (wrap instead of a hidden horizontal scroll).
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
  return (
    <div className="g-chips" role="tablist" aria-label={t("bid.filter.label")}>
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
  );
}
