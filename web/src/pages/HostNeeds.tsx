import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, LivePayload, Need } from "../lib/api";
import { Currency, formatMoney } from "../lib/money";
import { instantToWallTime, wallTimeToIso } from "../lib/time";
import type { RunAction } from "./HostEventCard";

type HostPledge = {
  id: string;
  guestId: string;
  guestName: string;
  guestPhone: string | null;
  amount: number;
  units: number | null;
  anonymous: boolean;
  status: "active" | "undone" | "voided";
  voidReason: string | null;
  receiptName: string | null;
};
type HostAudit = { id: string; action: string; actor: string; amount: number | null; previousAmount: number | null; reason: string | null; createdAt: string };
type HostNeed = Need & {
  hidden: boolean;
  ownEndsAt: string | null;
  closedAt: string | null;
  pledges: HostPledge[];
  audit: HostAudit[];
};
type FundPayload = { needs: HostNeed[]; needsEndsAt: string | null; spotlightNeedId: string | null; donations: number };

const emptyDraft = () => ({
  title: "",
  beneficiary: "Thai.GER charity",
  description: "",
  targetAmount: "10000",
  minPledge: "500",
  presets: "1000, 5000, 10000, 25000",
  unitLabel: "",
  unitAmount: "",
  capAtTarget: false,
  endsAt: "",
});

function parsePresets(raw: string): number[] {
  return raw
    .split(/[, ]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => n > 0);
}

export function HostNeeds(props: { code: string; ccy: Currency; tz: string; run: RunAction }) {
  const { code, ccy, tz, run } = props;
  const [data, setData] = useState<FundPayload | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [endLocal, setEndLocal] = useState("");
  const [staysOpen, setStaysOpen] = useState(true);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [correctAmt, setCorrectAmt] = useState<Record<string, string>>({});
  const money = (n: number) => formatMoney(n, ccy);

  const load = useCallback(async () => {
    const res = await api<FundPayload>(`/api/host/events/${code}/needs`);
    setData(res);
    setStaysOpen(!res.needsEndsAt);
    setEndLocal(res.needsEndsAt ? instantToWallTime(res.needsEndsAt, tz) : "");
  }, [code, tz]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function act(fn: () => Promise<LivePayload | void>, note: string) {
    const ok = await run(fn, note);
    if (ok) await load().catch(() => undefined);
    return ok;
  }

  function bodyFromDraft(d: typeof draft) {
    return {
      title: d.title.trim(),
      beneficiary: d.beneficiary.trim(),
      description: d.description,
      targetAmount: Number(d.targetAmount),
      minPledge: Number(d.minPledge),
      suggestedAmounts: parsePresets(d.presets),
      unitLabel: d.unitLabel.trim() || null,
      unitAmount: d.unitAmount.trim() ? Number(d.unitAmount) : null,
      capAtTarget: d.capAtTarget,
      endsAt: d.endsAt ? wallTimeToIso(d.endsAt, tz) : null,
    };
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      () => api<{ live: LivePayload }>(`/api/host/events/${code}/needs`, { method: "POST", body: JSON.stringify(bodyFromDraft(draft)) }).then((r) => r.live),
      `Added “${draft.title.trim()}”.`,
    );
    if (ok) {
      setCreating(false);
      setDraft(emptyDraft());
    }
  }

  async function saveEnd(e: FormEvent) {
    e.preventDefault();
    const needsEndsAt = staysOpen ? null : wallTimeToIso(endLocal, tz);
    if (!staysOpen && !needsEndsAt) return;
    await act(
      () =>
        api<{ live: LivePayload }>(`/api/host/events/${code}/fund`, {
          method: "PATCH",
          body: JSON.stringify({ needsEndsAt }),
        }).then((r) => r.live),
      staysOpen ? "Fund-a-Need stays open after the auction." : "Fund-a-Need end time saved.",
    );
  }

  function move(ids: string[], index: number, dir: -1 | 1) {
    const next = [...ids];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    act(
      () => api<{ live: LivePayload }>(`/api/host/events/${code}/needs/reorder`, { method: "POST", body: JSON.stringify({ ids: next }) }).then((r) => r.live),
      "Order saved.",
    ).catch(() => undefined);
  }

  if (!data) return <p className="muted">Loading Fund-a-Need…</p>;
  const needs = data.needs;
  const byGuest = new Map<string, { name: string; phone: string | null; total: number; count: number }>();
  for (const n of needs) {
    for (const p of n.pledges) {
      if (p.status !== "active") continue;
      const row = byGuest.get(p.guestId) ?? { name: p.guestName, phone: p.guestPhone, total: 0, count: 0 };
      row.total += p.amount;
      row.count += 1;
      byGuest.set(p.guestId, row);
    }
  }

  return (
    <div className="stack fund-host">
      <div className="row between">
        <h3>Fund-a-Need</h3>
        <div className="row">
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              act(
                () => api<{ live: LivePayload }>(`/api/host/events/${code}/needs/examples`, { method: "POST", body: "{}" }).then((r) => r.live),
                "Example needs added.",
              )
            }
          >
            Add example needs
          </button>
          {!creating && (
            <button type="button" className="button secondary" onClick={() => setCreating(true)}>
              Add need
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        Donations {money(data.donations)}. These are not bids — many guests can fund the same need. Example rows are labelled example data.
      </p>
      <form className="stack" onSubmit={saveEnd}>
        <label className="inline-check">
          <input type="checkbox" checked={staysOpen} onChange={(e) => setStaysOpen(e.target.checked)} />
          Stays open after the auction (no shared end time)
        </label>
        {!staysOpen && (
          <label>
            Fund-a-Need closes ({tz})
            <input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} required />
          </label>
        )}
        <button className="button secondary" type="submit">Save Fund-a-Need time</button>
        {data.spotlightNeedId && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              act(
                () =>
                  api<{ live: LivePayload }>(`/api/host/events/${code}/fund`, {
                    method: "PATCH",
                    body: JSON.stringify({ spotlightNeedId: null }),
                  }).then((r) => r.live),
                "Spotlight cleared.",
              )
            }
          >
            Clear big-screen spotlight
          </button>
        )}
      </form>

      {creating && (
        <NeedForm
          draft={draft}
          setDraft={setDraft}
          ccy={ccy}
          submitLabel="Create need"
          onCancel={() => setCreating(false)}
          onSubmit={onCreate}
        />
      )}

      <ul className="stack">
        {needs.map((n, index) => (
          <li key={n.id} className="stack card nested">
            <div className="line-row">
              <span>
                <strong>{n.title}</strong>
                {n.beneficiary ? ` · ${n.beneficiary}` : ""} — {money(n.raised)} / {money(n.targetAmount)} · {n.label}
              </span>
              {n.example && <span className="pill">example</span>}
              {n.hidden && <span className="pill">hidden</span>}
              {!n.open && <span className="pill">closed</span>}
              {n.capAtTarget && <span className="pill">capped</span>}
              {data.spotlightNeedId === n.id && <span className="pill kind-fixed">spotlight</span>}
            </div>
            <div className="row">
              <button type="button" className="button secondary" onClick={() => move(needs.map((x) => x.id), index, -1)} disabled={index === 0}>Up</button>
              <button type="button" className="button secondary" onClick={() => move(needs.map((x) => x.id), index, 1)} disabled={index === needs.length - 1}>Down</button>
              <button type="button" className="button secondary" onClick={() => setOpen(open === n.id ? null : n.id)}>
                {open === n.id ? "Close editor" : "Edit"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  act(
                    () =>
                      api<{ live: LivePayload }>(`/api/host/events/${code}/needs/${n.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ hidden: !n.hidden }),
                      }).then((r) => r.live),
                    n.hidden ? "Need visible to guests." : "Need hidden.",
                  )
                }
              >
                {n.hidden ? "Show" : "Hide"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  act(
                    () =>
                      api<{ live: LivePayload }>(`/api/host/events/${code}/needs/${n.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ closed: n.open }),
                      }).then((r) => r.live),
                    n.open ? "Need closed." : "Need reopened.",
                  )
                }
              >
                {n.open ? "Close need" : "Reopen"}
              </button>
              {!n.hidden && (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    act(
                      () =>
                        api<{ live: LivePayload }>(`/api/host/events/${code}/fund`, {
                          method: "PATCH",
                          body: JSON.stringify({ spotlightNeedId: n.id }),
                        }).then((r) => r.live),
                      `Spotlight: ${n.title}.`,
                    )
                  }
                >
                  Spotlight
                </button>
              )}
              {n.pledges.length === 0 && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    act(
                      () => api<LivePayload>(`/api/host/events/${code}/needs/${n.id}`, { method: "DELETE" }),
                      `Deleted “${n.title}”.`,
                    )
                  }
                >
                  Delete
                </button>
              )}
            </div>
            {open === n.id && (
              <EditNeed code={code} need={n} tz={tz} ccy={ccy} act={act} />
            )}
            {n.pledges.length > 0 && (
              <ul className="stack">
                {n.pledges.map((p) => (
                  <li key={p.id} className="line-row">
                    <span>
                      {p.guestName}
                      {p.guestPhone ? ` · ${p.guestPhone}` : ""} — {money(p.amount)}
                      {p.units ? ` · ${p.units}` : ""}
                      {p.anonymous ? " · anonymous on screen" : ""}
                      {p.receiptName ? ` · receipt: ${p.receiptName}` : ""}
                      {p.status !== "active" ? ` · ${p.status}` : ""}
                      {p.voidReason ? ` · ${p.voidReason}` : ""}
                    </span>
                    {p.status === "active" && (
                      <span className="row">
                        <input
                          aria-label={`Correct amount for ${p.guestName}`}
                          value={correctAmt[p.id] ?? ""}
                          onChange={(e) => setCorrectAmt((m) => ({ ...m, [p.id]: e.target.value }))}
                          placeholder="New amount"
                          style={{ width: "7rem" }}
                        />
                        <input
                          aria-label={`Reason for ${p.guestName}`}
                          value={reason[p.id] ?? ""}
                          onChange={(e) => setReason((m) => ({ ...m, [p.id]: e.target.value }))}
                          placeholder="Reason"
                        />
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() =>
                            act(
                              () =>
                                api<{ live: LivePayload }>(`/api/host/events/${code}/pledges/${p.id}/correct`, {
                                  method: "POST",
                                  body: JSON.stringify({ amount: Number(correctAmt[p.id]), reason: reason[p.id] || "" }),
                                }).then((r) => r.live),
                              "Pledge corrected.",
                            )
                          }
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          className="button danger"
                          onClick={() =>
                            act(
                              () =>
                                api<{ live: LivePayload }>(`/api/host/events/${code}/pledges/${p.id}/void`, {
                                  method: "POST",
                                  body: JSON.stringify({ reason: reason[p.id] || "" }),
                                }).then((r) => r.live),
                              "Pledge voided.",
                            )
                          }
                        >
                          Void
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {n.audit.length > 0 && (
              <p className="muted">
                Audit: {n.audit.slice(0, 4).map((a) => `${a.action} by ${a.actor}${a.reason ? ` (${a.reason})` : ""}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>

      {byGuest.size > 0 && (
        <div>
          <h3>Pledges by guest</h3>
          <ul className="stack">
            {[...byGuest.values()].map((g) => (
              <li key={g.name + (g.phone ?? "")}>
                <strong>{g.name}</strong>
                {g.phone ? ` · ${g.phone}` : ""} — {money(g.total)} · {g.count} pledge{g.count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NeedForm(props: {
  draft: ReturnType<typeof emptyDraft>;
  setDraft: (d: ReturnType<typeof emptyDraft>) => void;
  ccy: Currency;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const { draft: d, setDraft, submitLabel, onCancel, onSubmit } = props;
  const set = (patch: Partial<typeof d>) => setDraft({ ...d, ...patch });
  return (
    <form className="stack card nested" onSubmit={onSubmit}>
      <label>Title <input value={d.title} onChange={(e) => set({ title: e.target.value })} required /></label>
      <label>Charity / beneficiary <input value={d.beneficiary} onChange={(e) => set({ beneficiary: e.target.value })} /></label>
      <label>Description <textarea value={d.description} onChange={(e) => set({ description: e.target.value })} rows={3} /></label>
      <div className="row">
        <label>Target ({props.ccy}) <input value={d.targetAmount} onChange={(e) => set({ targetAmount: e.target.value })} required /></label>
        <label>Minimum pledge <input value={d.minPledge} onChange={(e) => set({ minPledge: e.target.value })} required /></label>
      </div>
      <label>Suggested amounts <input value={d.presets} onChange={(e) => set({ presets: e.target.value })} placeholder="1000, 5000, 10000, 25000" /></label>
      <div className="row">
        <label>Unit name <input value={d.unitLabel} onChange={(e) => set({ unitLabel: e.target.value })} placeholder="uniform" /></label>
        <label>Price per unit <input value={d.unitAmount} onChange={(e) => set({ unitAmount: e.target.value })} placeholder="800" /></label>
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={d.capAtTarget} onChange={(e) => set({ capAtTarget: e.target.checked })} />
        Stop pledges at the target
      </label>
      <label>
        This need closes (optional, overrides the shared end)
        <input type="datetime-local" value={d.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
      </label>
      <div className="row">
        <button className="button" type="submit">{submitLabel}</button>
        <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EditNeed(props: {
  code: string;
  need: HostNeed;
  tz: string;
  ccy: Currency;
  act: (fn: () => Promise<LivePayload | void>, note: string) => Promise<boolean>;
}) {
  const { need: n, tz, ccy, code, act } = props;
  const [draft, setDraft] = useState({
    title: n.title,
    beneficiary: n.beneficiary,
    description: n.description,
    targetAmount: String(n.targetAmount),
    minPledge: String(n.minPledge),
    presets: n.suggestedAmounts.join(", "),
    unitLabel: n.unitLabel ?? "",
    unitAmount: n.unitAmount == null ? "" : String(n.unitAmount),
    capAtTarget: n.capAtTarget,
    endsAt: n.ownEndsAt ? instantToWallTime(n.ownEndsAt, tz) : "",
  });
  return (
    <NeedForm
      draft={draft}
      setDraft={setDraft}
      ccy={ccy}
      submitLabel="Save need"
      onCancel={() => setDraft(draft)}
      onSubmit={async (e) => {
        e.preventDefault();
        await act(
          () =>
            api<{ live: LivePayload }>(`/api/host/events/${code}/needs/${n.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                title: draft.title.trim(),
                beneficiary: draft.beneficiary.trim(),
                description: draft.description,
                targetAmount: Number(draft.targetAmount),
                minPledge: Number(draft.minPledge),
                suggestedAmounts: parsePresets(draft.presets),
                unitLabel: draft.unitLabel.trim() || null,
                unitAmount: draft.unitAmount.trim() ? Number(draft.unitAmount) : null,
                capAtTarget: draft.capAtTarget,
                endsAt: draft.endsAt ? wallTimeToIso(draft.endsAt, tz) : null,
              }),
            }).then((r) => r.live),
          "Need saved.",
        );
      }}
    />
  );
}
