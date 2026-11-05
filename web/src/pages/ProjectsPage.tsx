import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getGuestToken, Gewerk, Project } from "../lib/api";
import { formatAmount, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import { plural, t } from "../i18n";
import { GuestHeader } from "../guest/GuestHeader";
import { useNow } from "../guest/useNow";
import "../guest/guest.css";

export function ProjectsPage() {
  const { code = "" } = useParams();
  const { live, error, clockOffsetMs } = useLive(code);
  const now = useNow(clockOffsetMs);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const token = getGuestToken(code);

  useEffect(() => {
    if (!token) return;
    api<{ gifts: Array<{ gewerkId: string; amount: number }> }>(`/api/events/${code}/me/project-pledges`, {}, token)
      .then((res) => {
        const next: Record<string, number> = {};
        for (const gift of res.gifts) next[gift.gewerkId] = gift.amount;
        setMine(next);
      })
      .catch(() => undefined);
  }, [code, token, live?.projects]);

  if (error && !live) return <p className="g-loading">{error}</p>;
  if (!live) return <p className="g-loading" role="status">{t("app.loading")}</p>;

  const project = live.projects?.[0];
  const ccy = parseCurrency(live.event.currency);
  const gewerk = project?.gewerke.find((g) => g.id === openId) ?? null;

  async function pledge(mode: "full" | "partial", raw?: number) {
    if (!gewerk) return;
    setBusy(true);
    setFormError(null);
    setNote(null);
    try {
      const res = await api<{ pledge: { amount: number; gewerkId?: string } }>(
        `/api/events/${code}/gewerke/${gewerk.id}/pledges`,
        { method: "POST", body: JSON.stringify({ mode, amount: raw }) },
        token,
      );
      setMine((prev) => ({ ...prev, [gewerk.id]: (prev[gewerk.id] ?? 0) + res.pledge.amount }));
      setNote(t("project.pledgeRecorded", { amount: formatAmount(res.pledge.amount, ccy) }));
      setAmount("");
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPartial(e: FormEvent) {
    e.preventDefault();
    const n = Number(String(amount).replace(/,/g, ""));
    if (!gewerk) return;
    if (!(n > 0) || n > gewerk.remaining + 0.001) {
      setFormError(t("project.tooMuch", { amount: formatAmount(gewerk.remaining, ccy) }));
      return;
    }
    void pledge("partial", n);
  }

  return (
    <section className="g-page g-board">
      <GuestHeader
        title={live.event.title}
        status={live.event.status}
        startsAt={live.event.startsAt}
        endsAt={live.event.endsAt}
        now={now}
        timezone={live.event.timezone}
        closedEarly={live.event.closedEarly}
      />
      <div className="g-content">
        <Link className="g-link" to={`/e/${code}/bid`}>{t("project.back")}</Link>
        {!project ? (
          <p className="g-empty">{t("project.empty")}</p>
        ) : (
          <ProjectView
            project={project}
            ccy={ccy}
            openId={openId}
            mine={mine}
            onOpen={(id) => {
              setOpenId(id);
              setFormError(null);
              setNote(null);
              setAmount("");
            }}
          />
        )}
      </div>
      {gewerk && (
        <div className="g-sheet-back" role="presentation" onClick={() => setOpenId(null)}>
          <form className="g-sheet" onClick={(e) => e.stopPropagation()} onSubmit={onPartial}>
            <div className="g-sheet-bar">
              <h2>{gewerk.title}</h2>
              <button type="button" className="g-sheet-x" aria-label={t("install.dismiss")} onClick={() => setOpenId(null)}>×</button>
            </div>
            {gewerk.placeholder && <p className="g-placeholder">{t("project.placeholderNote")}</p>}
            <p className="g-muted">{gewerk.description}</p>
            <p className="g-price-label">{t("project.target")}</p>
            <p className="g-project-figure">{formatAmount(gewerk.target, ccy)}</p>
            <div className="g-progress" aria-hidden="true"><span style={{ width: `${gewerk.percent}%` }} /></div>
            <p>
              {formatAmount(gewerk.raised, ccy)} {t("project.of", { amount: formatAmount(gewerk.target, ccy) })}
              {" · "}
              {plural("project.oneDonor", "project.donors", gewerk.donorCount)}
            </p>
            {mine[gewerk.id] ? <p className="g-yours-pledge">{t("project.yours", { amount: formatAmount(mine[gewerk.id], ccy) })}</p> : null}
            {gewerk.donors.length > 0 && (
              <ul className="g-supported">
                {gewerk.donors.map((d, i) => (
                  <li key={`${d.name}-${i}`}><span>{d.name}</span><strong>{formatAmount(d.amount, ccy)}</strong></li>
                ))}
              </ul>
            )}
            {!token ? (
              <p><Link className="g-primary" to={`/e/${code}`}>{t("project.joinToGive")}</Link></p>
            ) : gewerk.funded ? (
              <p className="g-funded">{t("project.fundedAlready")}</p>
            ) : (
              <>
                <button type="button" className="g-primary" disabled={busy} onClick={() => void pledge("full")}>
                  {t("project.takeoverCta", { amount: formatAmount(gewerk.remaining, ccy) })}
                </button>
                <label className="g-partial">
                  {t("project.partialLabel")}
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("project.partial")} />
                </label>
                <button type="submit" className="g-secondary" disabled={busy}>
                  {t("project.partialSave", { amount: amount.trim() ? formatAmount(Number(amount.replace(/,/g, "")) || 0, ccy) : "" })}
                </button>
              </>
            )}
            {formError && <p className="g-error" role="alert">{formError}</p>}
            {note && <p className="g-ok" role="status">{note}</p>}
          </form>
        </div>
      )}
    </section>
  );
}

function ProjectView({
  project,
  ccy,
  openId,
  mine,
  onOpen,
}: {
  project: Project;
  ccy: ReturnType<typeof parseCurrency>;
  openId: string | null;
  mine: Record<string, number>;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      {project.placeholder && (
        <p className="g-placeholder" role="note">
          <strong>{t("project.placeholder")}</strong> {t("project.placeholderNote")}
        </p>
      )}
      <p className="g-kicker">{t("project.kicker")}</p>
      <h2 className="g-project-title">{project.title}</h2>
      <p className="g-muted">{project.description}</p>
      <p className="g-price-label">{t("project.building")}</p>
      <div className="g-building" aria-hidden="true">
        <div className="g-roof" />
        {project.gewerke.map((g) => (
          <div key={g.id} className="g-floor">
            <i style={{ width: `${g.percent}%` }} />
            <span>{g.title}</span>
            <strong>{g.percent}%</strong>
          </div>
        ))}
      </div>
      <p>
        <span className="g-price-label">{t("project.progress")}</span>{" "}
        <strong>{project.percent}%</strong>
        {" · "}
        {formatAmount(project.raised, ccy)} {t("project.of", { amount: formatAmount(project.target, ccy) })}
      </p>
      <ul className="g-gewerke">
        {project.gewerke.map((g) => (
          <li key={g.id}>
            <button type="button" className={openId === g.id ? "is-open" : ""} onClick={() => onOpen(g.id)}>
              <GewerkLine gewerk={g} ccy={ccy} mine={mine[g.id]} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function GewerkLine({ gewerk, ccy, mine }: { gewerk: Gewerk; ccy: ReturnType<typeof parseCurrency>; mine?: number }) {
  return (
    <>
      <span className="g-gewerk-name">
        {gewerk.title}
        {gewerk.placeholder && <em>{t("project.placeholder")}</em>}
      </span>
      <span className="g-progress" aria-hidden="true"><span style={{ width: `${gewerk.percent}%` }} /></span>
      <span className="g-gewerk-meta">
        {formatAmount(gewerk.raised, ccy)} / {formatAmount(gewerk.target, ccy)}
        {gewerk.funded ? ` · ${t("project.funded")}` : ` · ${t("project.remaining", { amount: formatAmount(gewerk.remaining, ccy) })}`}
        {mine ? ` · ${t("project.yours", { amount: formatAmount(mine, ccy) })}` : ""}
      </span>
    </>
  );
}
