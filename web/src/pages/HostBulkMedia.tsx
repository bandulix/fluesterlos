import { DragEvent, useState } from "react";
import { LiveItem, uploadForm } from "../lib/api";
import { baseTitle, FileMatch, matchFile, withLots } from "../lib/fileMatch";

type Row = FileMatch & { file: File; status?: "done" | "error"; error?: string };

/**
 * Bulk photos & voucher PDFs: drop many files, each is matched to an item by lot number
 * ("03-spa.jpg") or title ("Spa Day.pdf"); the host can correct any match, then everything is
 * uploaded one file per request through the normal per-item endpoints.
 */
export function HostBulkMedia(props: {
  code: string;
  items: LiveItem[];
  intro?: string;
  onClose: () => void;
  onDone: (note: string) => Promise<void>;
}) {
  const { code, items } = props;
  const lots = withLots(items);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | File[]) {
    const next = [...rows];
    for (const file of Array.from(list)) {
      if (next.some((r) => r.name === file.name && r.file.size === file.size)) continue;
      next.push({ ...matchFile(file.name, lots, file.type), file });
    }
    setRows(next);
  }

  /** Dropdown value: "id" for one item, "group:<base title>" for every unit of a multi-unit lot. */
  function choose(i: number, value: string) {
    setRows((rs) =>
      rs.map((r, n) => {
        if (n !== i || value === "multi") return r;
        if (!value) return { ...r, itemIds: [], how: null, note: "Not uploaded" };
        if (value.startsWith("group:")) {
          const t = value.slice(6);
          return { ...r, itemIds: lots.filter((l) => baseTitle(l.title) === t).map((l) => l.id), how: null, note: undefined };
        }
        return { ...r, itemIds: [value], how: null, note: undefined };
      }),
    );
  }

  const groups = [...new Set(lots.filter((l) => /\(\d+\/\d+\)$/.test(l.title)).map((l) => baseTitle(l.title)))];
  const uploads = rows.reduce((n, r) => n + (r.status === "done" ? 0 : r.itemIds.length), 0);
  const readyFiles = rows.filter((r) => r.status !== "done" && r.itemIds.length > 0).length;
  const buttonLabel = `Upload ${readyFiles} file${readyFiles === 1 ? "" : "s"}${uploads > readyFiles ? ` (${uploads} items)` : ""}`;

  async function uploadAll() {
    setBusy(true);
    let done = 0;
    let failed = 0;
    const total = uploads;
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (r.status === "done" || !r.itemIds.length) continue;
      try {
        for (const id of r.itemIds) {
          setProgress(`Uploading ${done + 1} of ${total}…`);
          const form = new FormData();
          if (r.kind === "photo") {
            form.append("photo", r.file, r.file.name);
            await uploadForm(`/api/host/events/${code}/items/${id}`, form, undefined, "PATCH");
          } else {
            form.append("file", r.file, r.file.name);
            await uploadForm(`/api/host/events/${code}/items/${id}/voucher`, form);
          }
          done++;
        }
        next[i] = { ...r, status: "done" };
      } catch (e) {
        failed++;
        next[i] = { ...r, status: "error", error: (e as Error).message };
      }
      setRows([...next]);
    }
    setProgress(null);
    setBusy(false);
    const photos = next.filter((r) => r.status === "done" && r.kind === "photo").length;
    const pdfs = next.filter((r) => r.status === "done" && r.kind === "voucher").length;
    const note = `Uploaded ${photos} photo${photos === 1 ? "" : "s"} and ${pdfs} voucher PDF${pdfs === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}.`;
    await props.onDone(note);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const missingPhotos = items.filter((it) => !it.photoUrl).length;
  const missingPdfs = items.filter((it) => (it.kind ?? "voucher") === "voucher" && !it.hasVoucher).length;

  return (
    <div className="card nested stack import-panel">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Photos &amp; voucher PDFs</h3>
        <button type="button" className="button secondary" onClick={props.onClose} disabled={busy}>
          {rows.some((r) => r.status === "done") ? "Done" : "Close"}
        </button>
      </div>
      {props.intro && <p className="banner">{props.intro}</p>}
      <p className="muted">
        {missingPhotos} item{missingPhotos === 1 ? "" : "s"} without a photo · {missingPdfs} voucher{missingPdfs === 1 ? "" : "s"} without a PDF.
        Name files by lot number or title — <code>03-spa.jpg</code>, <code>Spa Day.pdf</code> — and drop them all at once.
      </p>
      <label
        className={`import-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>Choose or drop photos (jpg, png, webp) and voucher PDFs</strong>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.pdf"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {rows.length > 0 && (
        <div className="import-table-wrap">
          <table className="import-table media-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Kind</th>
                <th>Goes to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const single = r.itemIds.length === 1 ? r.itemIds[0] : "";
                const groupTitle =
                  r.itemIds.length > 1 ? baseTitle(lots.find((l) => l.id === r.itemIds[0])?.title ?? "") : "";
                const value = single || (groupTitle && groups.includes(groupTitle) && r.itemIds.length === lots.filter((l) => baseTitle(l.title) === groupTitle).length ? `group:${groupTitle}` : "");
                return (
                  <tr key={`${r.name}-${i}`} className={r.status === "done" ? "is-done" : ""}>
                    <td>{r.name}</td>
                    <td>{r.kind === "photo" ? "Photo" : r.kind === "voucher" ? "Voucher PDF" : "—"}</td>
                    <td>
                      {r.kind && (
                        <select value={value || (r.itemIds.length > 1 ? "multi" : "")} disabled={busy || r.status === "done"} onChange={(e) => choose(i, e.target.value)}>
                          <option value="">— not uploaded —</option>
                          {r.itemIds.length > 1 && !value && (
                            <option value="multi">{r.itemIds.length} items called “{groupTitle}”</option>
                          )}
                          {r.kind === "photo" &&
                            groups.map((g) => (
                              <option key={g} value={`group:${g}`}>All units of “{g}”</option>
                            ))}
                          {lots
                            .filter((l) => r.kind === "photo" || l.kind === "voucher")
                            .map((l) => (
                              <option key={l.id} value={l.id}>#{l.lot} {l.title}</option>
                            ))}
                        </select>
                      )}
                      {r.itemIds.length > 1 && <div className="muted import-hint">→ {r.itemIds.length} items</div>}
                      {r.note && !r.itemIds.length && <div className="muted import-hint">{r.note}</div>}
                    </td>
                    <td>
                      {r.status === "done" ? "✓ uploaded" : r.status === "error" ? <span className="error">{r.error}</span> : r.how ? `matched by ${r.how === "lot" ? "lot number" : "title"}` : r.itemIds.length ? "chosen" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row between">
        <span className="muted">{progress ?? (rows.length ? `${readyFiles} of ${rows.length} file${rows.length === 1 ? "" : "s"} matched — check the “Goes to” column` : "Each item can also get its photo or PDF individually in the list below.")}</span>
        <button type="button" className="button" disabled={busy || uploads === 0} onClick={uploadAll}>
          {busy ? "Uploading…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}
