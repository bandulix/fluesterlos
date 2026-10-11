import { FILTERS, FilterKey } from "../lib/bidLogic";
import { t } from "../i18n";

export function FilterChips({ value, counts, onChange }: { value: FilterKey; counts: Record<FilterKey, number>; onChange: (f: FilterKey) => void }) {
  return (
    <div className="g-chips" role="tablist" aria-label="Filter items">
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={value === f}
          className={`g-chip g-chip-${f}${value === f ? " is-active" : ""}`}
          onClick={() => onChange(f)}
        >
          {t(`bid.filter.${f}`)}
          {f !== "all" && counts[f] > 0 && <span className="g-chip-count">{counts[f]}</span>}
        </button>
      ))}
    </div>
  );
}
