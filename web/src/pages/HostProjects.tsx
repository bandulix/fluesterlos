import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, API_BASE, uploadForm } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";

type Pledge = {
  id: string;
  guestName: string;
  guestPhone: string | null;
  amount: number;
  kind: "partial" | "full";
  paymentStatus: string;
  paymentProvider: string | null;
};
type GewerkRow = {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  sortOrder: number;
  placeholder: boolean;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  raised: number;
  remaining: number;
  percent: number;
  pledges: Pledge[];
};
type ProjectRow = {
  id: string;
  title: string;
  description: string;
  placeholder: boolean;
  countsAuction?: boolean;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  auctionRaised?: number;
  auctionLots?: number;
  sortOrder: number;
  gewerke: GewerkRow[];
};

function GewerkForm({ busy, onSubmit }: { busy: boolean; onSubmit: (title: string, target: number) => void }) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("100000");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(title, Number(target));
        setTitle("");
      }}
    >
      <div className="row">
        <label>Gewerk <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Placeholder target <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} required /></label>
      </div>
      <button className="button secondary" disabled={busy}>Add Gewerk</button>
    </form>
  );
}

export function HostProjects({ code, ccy }: { code: string; ccy: Currency }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ projects: ProjectRow[] }>(`/api/host/events/${code}/projects`);
    setProjects(res.projects);
  }, [code]);

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
      setNote(ok);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onCreateProject(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/host/events/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({ title, description, placeholder: true }),
      });
      setTitle("");
      setDescription("");
    }, "Project saved. Amounts stay placeholders until you change that flag.");
  }

  return (
    <div className="card">
      <h2>Projects</h2>
      <p className="muted">
        Crowdfunding beside the auction. Donors use the same join code. Pledges are recorded here;
        online payment is not connected yet. Placeholder amounts are not real targets.
        The example school name and descriptions follow the guest language (EN / ไทย / DE).
        A name you type here is shown as entered in every language.
        Upload a photo for the project and for each Gewerk. Until then guests see a labeled empty frame.
        Awarded lots (a closed lot, a buy-now sale, or every bid once the auction has ended) are added
        to the school building total. They are not pledges, and a leading bid on an open lot does not count yet.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="saved-note" role="status">{note}</p>}
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void run(() => api(`/api/host/events/${code}/projects/example`, { method: "POST", body: "{}" }), "Example school added. Every figure is a placeholder.")}
      >
        Add example school
      </button>
      {projects.map((project) => (
        <section key={project.id} className="stack">
          <h3>
            {project.title}{" "}
            {project.placeholder && <span className="pill">Placeholder</span>}
          </h3>
          <p className="muted">{project.description}</p>
          {project.countsAuction && (
            <p className="muted">
              Auction awards on this building: {formatAmount(project.auctionRaised ?? 0, ccy)}
              {project.auctionLots ? ` · ${project.auctionLots} lots` : ""}. Not counted inside a Gewerk.
            </p>
          )}
          {project.photoUrl && <img src={`${API_BASE}${project.photoUrl}`} alt="" className="thumb" />}
          <label className="file-btn">
            {project.hasPhoto ? "Replace project image" : "Project image"}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.append("file", file);
                void run(() => uploadForm(`/api/host/events/${code}/projects/${project.id}/photo`, body), "Project image saved.");
              }}
            />
          </label>
          <ul className="auction-list">
            {project.gewerke.map((g) => (
              <li key={g.id} className="auction-row">
                <span className="auction-meta">
                  <strong>
                    {g.title} {g.placeholder && <span className="pill">Placeholder</span>}
                  </strong>
                  <span className="muted">
                    {formatAmount(g.raised, ccy)} of {formatAmount(g.targetAmount, ccy)} · {g.percent}%
                    {g.pledges.filter((p) => p.paymentStatus !== "void").length
                      ? ` · ${g.pledges.filter((p) => p.paymentStatus !== "void").length} pledges`
                      : ""}
                  </span>
                  {g.pledges.length > 0 && (
                    <ul>
                      {g.pledges.map((p) => (
                        <li key={p.id}>
                          {p.guestName}
                          {p.guestPhone ? ` · ${p.guestPhone}` : ""} · {formatAmount(p.amount, ccy)} · {p.kind} · {p.paymentStatus}
                          {p.paymentProvider ? ` · ${p.paymentProvider}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
                <span className="row">
                  {g.photoUrl && <img src={`${API_BASE}${g.photoUrl}`} alt="" className="thumb" />}
                  <label className="file-btn">
                    {g.hasPhoto ? "Replace image" : "Gewerk image"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const body = new FormData();
                        body.append("file", file);
                        void run(() => uploadForm(`/api/host/events/${code}/gewerke/${g.id}/photo`, body), "Gewerk image saved.");
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt("Gewerk name", g.title);
                      if (!next?.trim()) return;
                      const amount = window.prompt("Placeholder target", String(g.targetAmount));
                      const target = Number(amount);
                      if (!(target > 0)) return;
                      void run(
                        () => api(`/api/host/events/${code}/gewerke/${g.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ title: next.trim(), targetAmount: target, placeholder: true }),
                        }),
                        "Gewerk updated. It stays a placeholder.",
                      );
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="button secondary" disabled={busy} onClick={() => void run(() => api(`/api/host/events/${code}/gewerke/${g.id}`, { method: "DELETE" }), "Gewerk removed.")}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <GewerkForm
            busy={busy}
            onSubmit={(name, target) =>
              void run(async () => {
                await api(`/api/host/events/${code}/projects/${project.id}/gewerke`, {
                  method: "POST",
                  body: JSON.stringify({ title: name, targetAmount: target, placeholder: true }),
                });
              }, "Gewerk saved as a placeholder target.")
            }
          />
        </section>
      ))}
      <form className="stack" onSubmit={onCreateProject}>
        <h3>New project</h3>
        <label>Name <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Description <input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <button className="button secondary" disabled={busy}>Create project</button>
      </form>
    </div>
  );
}
