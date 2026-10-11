import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE, assetUrl, LivePayload } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";

type Field = string;
type Issue = { level: "error" | "warning" | "info"; message: string; field?: Field };
type PreviewRow = {
  key: number;
  lot: string | null;
  title: string;
  description: string;
  kind: "voucher" | "physical";
  kindGuessed: boolean;
  sponsor: string | null;
  sponsorIsNew: boolean;
  retailValue: number | null;
  startingBid: number | null;
  increment: number | null;
  buyNow: number | null;
  quantity: number;
  notes: string;
  fixedPrice: boolean;
  skip: boolean;
  photoUrl: string | null;
  logoUrl: string | null;
  issues: Issue[];
};
type Override = {
  skip?: boolean;
  kind?: "voucher" | "physical";
  title?: string;
  startingBid?: number | null;
  increment?: number | null;
  buyNow?: number | null;
};
export type ImportPreview = {
  sessionId: string;
  fileName: string;
  sheetName: string;
  skippedSheets: string[];
  headerRow: number;
  columns: Array<{ index: number; header: string; field: Field | null; samples: string[] }>;
  fields: Array<{ value: Field; label: string }>;
  mapping: Array<Field | null>;
  rows: PreviewRow[];
  droppedTotals: number;
  summary: { rows: number; items: number; skipped: number; blocked: number; warnings: number; rowsToCheck?: number; errors: number; multiUnitLots: number; fixedPrice: number; photos: number };
  existingItems: number;
  locked: string | null;
};
type CommitResult = { created: number; items: Array<{ id: string; title: string; lot: number }>; live: LivePayload };

const ACCEPT = ".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
export const TEMPLATE_URL = `${API_BASE}/api/host/import/template.xlsx`;

/** "Liste 35 … Liste 1" instead of 35 names. */
function sheetList(names: string[]): string {
  const bid = names.filter((n) => /^(liste|list|bid ?sheet|sheet)\s*\d+$/i.test(n));
  const other = names.filter((n) => !bid.includes(n));
  const parts: string[] = [];
  if (bid.length > 2) parts.push(`${bid.length} bid sheets (${bid[0]} … ${bid[bid.length - 1]})`);
  else parts.push(...bid);
  parts.push(...other.map((n) => `“${n}”`));
  return parts.join(", ");
}

const num = (s: string): number | null => {
  const t = s.trim().replace(/[\s,]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const TYPE_DEBOUNCE_MS = 350;

/**
 * Price cell that keeps its own draft while focused and reports the parsed value ~350 ms after
 * typing stops (and on blur), so the preview's item count follows the typing, not only the blur.
 */
function NumInput(props: { value: number | null; onValue: (v: number | null) => void; placeholder?: string; disabled?: boolean; "aria-label": string }) {
  const { value, onValue } = props;
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const lastSent = useRef<number | null>(value);
  useEffect(() => {
    lastSent.current = value;
    if (!focused.current) setDraft(value == null ? "" : String(value));
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flush = (text: string) => {
    window.clearTimeout(timer.current);
    const v = num(text);
    if (v !== lastSent.current) {
      lastSent.current = v;
      onValue(v);
    }
  };
  return (
    <input
      className="import-num"
      inputMode="decimal"
      aria-label={props["aria-label"]}
      placeholder={props.placeholder}
      disabled={props.disabled}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => flush(text), TYPE_DEBOUNCE_MS);
      }}
      onBlur={(e) => {
        focused.current = false;
        flush(e.target.value);
      }}
    />
  );
}

function TitleInput(props: { value: string; onValue: (v: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(props.value);
  }, [props.value]);
  return (
    <input
      value={draft}
      maxLength={200}
      aria-label="Title"
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        const v = draft.trim();
        if (v && v !== props.value) props.onValue(v);
        else setDraft(props.value);
      }}
    />
  );
}

/**
 * Host import: upload .xlsx/.csv → preview with column mapping, per-row issues and edits
 * (import yes/no, title, type, prices) → "Import N items". Parsing happens on the server; the
 * preview is recomputed there after every change so what you see is exactly what gets created.
 */
export function HostItemImport(props: {
  code: string;
  ccy: Currency;
  lockedReason: string | null;
  onClose: () => void;
  onImported: (res: CommitResult) => Promise<void>;
}) {
  const { code, ccy } = props;
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const seq = useRef(0);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch(`${API_BASE}/api/host/events/${code}/import`, { method: "POST", body: form, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
      setOverrides({});
      setPreview(data as ImportPreview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh(mapping: Array<Field | null>, next: Record<number, Override>) {
    if (!preview) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const data = await api<ImportPreview>(`/api/host/events/${code}/import/${preview.sessionId}/preview`, {
        method: "POST",
        body: JSON.stringify({ mapping, overrides: next }),
      });
      if (mine === seq.current) setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  // Refs so debounced edits (typed prices) never apply against a stale snapshot.
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  function setOverride(key: number, patch: Override) {
    const cur = overridesRef.current;
    const next = { ...cur, [key]: { ...cur[key], ...patch } };
    overridesRef.current = next;
    setOverrides(next);
    const pv = previewRef.current;
    if (pv) {
      // Optimistic: show the edit at once, then the server's recomputed row (defaults, issues, item count).
      const optimistic = { ...pv, rows: pv.rows.map((r) => (r.key === key ? ({ ...r, ...stripUndefined(patch) } as PreviewRow) : r)) };
      previewRef.current = optimistic;
      setPreview(optimistic);
      void refresh(pv.mapping, next);
    }
  }

  function setMapping(index: number, field: Field | null) {
    if (!preview) return;
    const mapping = preview.mapping.map((f, i) => (i === index ? field : f === field && field && field !== "ignore" ? null : f));
    setPreview({ ...preview, mapping });
    void refresh(mapping, overrides);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<CommitResult>(`/api/host/events/${code}/import/${preview.sessionId}/commit`, {
        method: "POST",
        body: JSON.stringify({ mapping: preview.mapping, overrides }),
      });
      await props.onImported(res);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  const toCheck = preview ? preview.summary.rowsToCheck ?? preview.rows.filter((r) => r.issues.some((i) => i.level !== "info")).length : 0;
  const rows = useMemo(
    () => (preview ? (onlyIssues ? preview.rows.filter((r) => r.issues.some((i) => i.level !== "info")) : preview.rows) : []),
    [preview, onlyIssues],
  );
  const s = preview?.summary;
  const countInfo = (field: string) =>
    preview ? preview.rows.filter((r) => r.issues.some((i) => i.level === "info" && i.field === field)).length : 0;
  const autoTitles = countInfo("title");
  const autoIncrements = countInfo("increment");
  const unmapped = preview ? preview.columns.filter((c) => !preview.mapping[c.index]) : [];
  const fieldLabel = (f: Field | null) => preview?.fields.find((x) => x.value === f)?.label ?? "";
  const has = (f: string) => Boolean(preview?.mapping.includes(f));
  const missingCore = preview
    ? [
        ...(!has("title") && !has("description") ? ["title"] : []),
        ...(!has("startingBid") && !has("retailValue") ? ["startingBid"] : []),
      ]
    : [];

  return (
    <div className="card nested stack import-panel import-wide">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Import items</h3>
        <button type="button" className="button secondary" onClick={props.onClose} disabled={busy && !preview}>
          {preview ? "Cancel import" : "Close"}
        </button>
      </div>

      {props.lockedReason && <p className="error">{props.lockedReason}</p>}

      {!preview && (
        <>
          <label
            className={`import-drop${dragging ? " is-dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <strong>{busy ? "Reading the file…" : "Choose or drop an Excel (.xlsx) or CSV file"}</strong>
            <span className="muted">
              One row per prize. Last year's “Prizes” sheet works as is — the paper bid sheets (“Liste 1”, …) are ignored, their
              photos and logos are picked up.
            </span>
            <span className="button drop-button" aria-hidden="true">{busy ? "Reading…" : "Choose file"}</span>
            <input
              className="drop-input"
              type="file"
              accept={ACCEPT}
              disabled={busy || Boolean(props.lockedReason)}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
          <p className="muted">
            Starting from scratch? <a href={TEMPLATE_URL} download>Download the blank template (.xlsx)</a> — columns: No., Title,
            Description, Type, Sponsor, Retail value, Starting bid, Increment, Buy now, Quantity, Notes.
          </p>
        </>
      )}

      {preview && s && (
        <>
          <p className="muted import-source">
            <strong>{preview.fileName}</strong> · sheet “{preview.sheetName}” (headers in row {preview.headerRow})
            {preview.skippedSheets.length > 0 && <> · ignored: {sheetList(preview.skippedSheets)}</>}
            {preview.droppedTotals > 0 && <> · {preview.droppedTotals} totals row{preview.droppedTotals === 1 ? "" : "s"} left out</>}
          </p>

          <details className="import-mapping" open={unmapped.length > 0 || missingCore.length > 0}>
            <summary>
              Columns: {preview.columns.length - unmapped.length} of {preview.columns.length} recognised
              {unmapped.length > 0 && <span className="pill warn">{unmapped.length} not mapped</span>}
            </summary>
            <div className="import-map-grid">
              {preview.columns.map((c) => {
                const f = preview.mapping[c.index];
                return (
                  <label key={c.index} className={f ? "" : "is-unmapped"}>
                    <span>
                      <strong>{c.header || `Column ${c.index + 1}`}</strong>
                      {c.samples.length > 0 && <span className="muted"> — e.g. “{c.samples[0]}”</span>}
                    </span>
                    <select value={f ?? ""} disabled={busy} onChange={(e) => setMapping(c.index, e.target.value || null)}>
                      <option value="">— choose a field —</option>
                      {preview.fields.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            {missingCore.length > 0 && (
              <p className="error">Map a column for: {missingCore.map(fieldLabel).join(", ")}.</p>
            )}
          </details>

          {(autoTitles > 0 || autoIncrements > 0) && (
            <p className="muted import-source">
              {autoTitles > 0 && <>Titles: first line of the description ({autoTitles} rows) — click a title to shorten it. </>}
              {autoIncrements > 0 && <>Increments: 10 % of the starting bid, as on last year's bid sheets ({autoIncrements} rows).</>}
            </p>
          )}
          <div className="import-summary" role="status">
            <span><strong>{s.rows}</strong> rows → <strong>{s.items}</strong> items</span>
            {s.multiUnitLots > 0 && <span>{s.multiUnitLots} multi-unit lot{s.multiUnitLots === 1 ? "" : "s"} split up</span>}
            {s.photos > 0 && <span>📷 {s.photos} photos from the workbook</span>}
            {s.skipped > 0 && <span>{s.skipped} skipped</span>}
            {toCheck > 0 && (
              <span className="is-warning" title={`${s.warnings} warning${s.warnings === 1 ? "" : "s"}, ${s.errors} error${s.errors === 1 ? "" : "s"}`}>
                ⚠ {toCheck} row{toCheck === 1 ? "" : "s"} to check
              </span>
            )}
            {s.errors > 0 && <span className="is-error">✕ {s.errors} need a fix</span>}
            {preview.existingItems > 0 && <span className="muted">added after the {preview.existingItems} existing item{preview.existingItems === 1 ? "" : "s"}</span>}
            <label className="import-filter">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> only rows to check{toCheck > 0 ? ` (${toCheck})` : ""}
            </label>
          </div>

          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th title="Import this row">Import</th>
                  <th>No.</th>
                  <th>Photo</th>
                  <th>Title, description &amp; notes</th>
                  <th>Type</th>
                  <th>Sponsor</th>
                  <th className="num">Value</th>
                  <th className="num">Starting bid</th>
                  <th className="num">Increment</th>
                  <th className="num">Buy now</th>
                  <th className="num">Qty</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hasError = !r.skip && r.issues.some((i) => i.level === "error");
                  const shown = r.issues.filter((i) => i.level !== "info");
                  const infos = r.issues.filter((i) => i.level === "info").map((i) => i.message).join("\n");
                  return (
                    <tr key={r.key} className={r.skip ? "is-skipped" : hasError ? "is-error" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Import ${r.title}`}
                          checked={!r.skip}
                          onChange={(e) => setOverride(r.key, { skip: !e.target.checked })}
                        />
                      </td>
                      <td className="muted">{r.lot ?? ""}</td>
                      <td>{r.photoUrl ? <img className="import-thumb" src={assetUrl(r.photoUrl)} alt="" loading="lazy" /> : <span className="muted">—</span>}</td>
                      <td className="import-title">
                        <TitleInput value={r.title} onValue={(v) => setOverride(r.key, { title: v })} />
                        {r.description && <div className="import-desc" title={r.description}>{r.description}</div>}
                        {r.notes && <div className="import-notes" title={r.notes}>Notes (host only): {r.notes}</div>}
                      </td>
                      <td>
                        <select
                          value={r.kind}
                          aria-label="Type"
                          onChange={(e) => setOverride(r.key, { kind: e.target.value as "voucher" | "physical" })}
                        >
                          <option value="voucher">Voucher</option>
                          <option value="physical">Physical</option>
                        </select>
                        {r.kindGuessed && <div className="muted import-hint">guessed</div>}
                      </td>
                      <td>
                        {r.sponsor ? (
                          <span className="import-sponsor">
                            {r.logoUrl && <img src={assetUrl(r.logoUrl)} alt="" />}
                            {r.sponsor}
                            <span className={`pill ${r.sponsorIsNew ? "" : "kind-voucher"}`}>{r.sponsorIsNew ? "new" : "existing"}</span>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">{r.retailValue != null ? formatAmount(r.retailValue, ccy) : <span className="muted">—</span>}</td>
                      <td className="num">
                        <NumInput
                          aria-label="Starting bid"
                          value={r.startingBid}
                          placeholder={r.fixedPrice ? "—" : "required"}
                          disabled={r.fixedPrice}
                          onValue={(v) => setOverride(r.key, { startingBid: v })}
                        />
                      </td>
                      <td className="num">
                        <NumInput
                          aria-label="Increment"
                          value={r.increment}
                          disabled={r.fixedPrice}
                          onValue={(v) => setOverride(r.key, { increment: v })}
                        />
                      </td>
                      <td className="num">
                        <NumInput
                          aria-label={r.fixedPrice ? "Fixed price" : "Buy now"}
                          value={r.buyNow}
                          placeholder={r.fixedPrice ? "price" : ""}
                          onValue={(v) => setOverride(r.key, { buyNow: v })}
                        />
                        {r.fixedPrice && <div className="muted import-hint">fixed price</div>}
                      </td>
                      <td className="num">{r.quantity > 1 ? <strong>{r.quantity}×</strong> : 1}</td>
                      <td className="import-issues">
                        {shown.length === 0 ? (
                          <span className="ok" title={infos || "Ready"}>✓{infos ? <span className="muted"> ℹ</span> : null}</span>
                        ) : (
                          <ul>
                            {shown.map((i, n) => (
                              <li key={n} className={`is-${i.level}`}>{i.message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="error">{error}</p>}
          <div className="row between import-actions">
            <span className="muted">
              {s.blocked > 0
                ? `${s.blocked} row${s.blocked === 1 ? "" : "s"} with ✕ won't be imported until fixed (or untick them).`
                : "Nothing is created until you import. Photos & voucher PDFs can be added in the next step."}
            </span>
            <button
              type="button"
              className="button"
              disabled={busy || s.items === 0 || Boolean(preview.locked)}
              onClick={commit}
            >
              {busy ? "Working…" : `Import ${s.items} item${s.items === 1 ? "" : "s"}`}
            </button>
          </div>
          {preview.locked && <p className="error">{preview.locked}</p>}
        </>
      )}
      {!preview && error && <p className="error">{error}</p>}
    </div>
  );
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
