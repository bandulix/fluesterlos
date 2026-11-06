import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, assetUrl, getGuestToken, Gewerk, GuestMe, Project } from "../lib/api";
import { SchoolBuilding } from "../guest/SchoolBuilding";
import { formatAmount, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import { plural, t } from "../i18n";
import { seedText } from "../lib/projectCopy";
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
  const [named, setNamed] = useState(false);
  const [publicName, setPublicName] = useState("");
  const [showAmount, setShowAmount] = useState(false);
  const [guestName, setGuestName] = useState("");
  const token = getGuestToken(code);

  useEffect(() => {
    if (!token) return;
    api<GuestMe>(`/api/events/${code}/me`, {}, token)
      .then((res) => {
        const guest = res.guest;
        if (!guest) return;
        setGuestName(guest.name || "");
        const rec = guest.recognition;
        if (!rec) return;
        setNamed(rec.namedPublicly);
        setPublicName(rec.publicName || guest.name || "");
        setShowAmount(rec.showAmount);
      })
      .catch(() => undefined);
  }, [code, token]);

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
        {
          method: "POST",
          body: JSON.stringify({
            mode,
            amount: raw,
            namedPublicly: named,
            publicName: named ? publicName.trim() || guestName : "",
            showAmount: named && showAmount,
          }),
        },
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
              <h2>{seedText(gewerk.copyKey, "title", gewerk.title)}</h2>
              <button type="button" className="g-sheet-x" aria-label={t("install.dismiss")} onClick={() => setOpenId(null)}>×</button>
            </div>
            <PhotoFrame src={gewerk.photoUrl} alt={seedText(gewerk.copyKey, "title", gewerk.title)} pending={t("project.tradePhotoPending")} />
            {gewerk.placeholder && <p className="g-placeholder">{t("project.placeholderNote")}</p>}
            <p className="g-muted">{seedText(gewerk.copyKey, "description", gewerk.description)}</p>
            <p className="g-visit">{t("project.visitShort")}</p>
            <p className="g-price-label">{t("project.target")}</p>
            <p className="g-project-figure">{formatAmount(gewerk.target, ccy)}</p>
            <div className="g-progress" aria-hidden="true"><span style={{ width: `${gewerk.percent}%` }} /></div>
            <p>
              {formatAmount(gewerk.raised, ccy)} {t("project.of", { amount: formatAmount(gewerk.target, ccy) })}
              {" · "}
              {plural("project.oneDonor", "project.donors", gewerk.donorCount)}
            </p>
            {mine[gewerk.id] ? <p className="g-yours-pledge">{t("project.yours", { amount: formatAmount(mine[gewerk.id], ccy) })}</p> : null}
            {(gewerk.donors.length > 0 || (gewerk.anonymousGifts ?? 0) > 0) && (
              <div className="g-supported">
                <p className="g-kicker">{t("donate.supported")}</p>
                {gewerk.donors.length > 0 && (
                  <ul>
                    {gewerk.donors.map((d, i) => (
                      <li key={`${d.name}-${i}`}>
                        <span>{d.name}</span>
                        {d.amount != null && <strong>{formatAmount(d.amount, ccy)}</strong>}
                      </li>
                    ))}
                  </ul>
                )}
                {(gewerk.anonymousGifts ?? 0) > 0 && (
                  <p className="g-muted">{plural("donate.anonGift", "donate.anonGifts", gewerk.anonymousGifts ?? 0)}</p>
                )}
              </div>
            )}
            {!token ? (
              <p><Link className="g-primary" to={`/e/${code}`}>{t("project.joinToGive")}</Link></p>
            ) : gewerk.funded ? (
              <p className="g-funded">{t("project.fundedAlready")}</p>
            ) : (
              <>
                <NamingChoice
                  named={named}
                  publicName={publicName}
                  showAmount={showAmount}
                  onNamed={(on) => {
                    setNamed(on);
                    if (on && !publicName.trim()) setPublicName(guestName);
                  }}
                  onPublicName={setPublicName}
                  onShowAmount={setShowAmount}
                />
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
      <h2 className="g-project-title">{seedText(project.copyKey, "title", project.title)}</h2>
      <p className="g-muted">{seedText(project.copyKey, "description", project.description)}</p>
      <p className="g-visit">{t("project.visit")}</p>
      <SchoolBuilding
        trades={project.gewerke}
        onOpen={onOpen}
        nameOf={(g) => seedText(g.copyKey, "title", g.title)}
      />
      {project.photoUrl ? (
        <PhotoFrame src={project.photoUrl} alt={seedText(project.copyKey, "title", project.title)} pending={t("project.photoPending")} />
      ) : (
        <p className="g-muted">{t("project.photoPending")}</p>
      )}
      {project.countsAuction && (
        <p className="g-auction-share">
          <strong>{t("project.auction")}</strong>{" "}
          {(project.auctionRaised ?? 0) > 0 ? (
            <>
              {formatAmount(project.auctionRaised ?? 0, ccy)}
              {" · "}
              {plural("project.auctionOneLot", "project.auctionLots", project.auctionLots ?? 0)}
            </>
          ) : (
            <span className="g-muted">{t("project.auctionWaiting")}</span>
          )}
          {(project.auctionRaised ?? 0) > 0 && <span className="g-muted"> {t("project.auctionNote")}</span>}
        </p>
      )}
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

function NamingChoice({
  named,
  publicName,
  showAmount,
  onNamed,
  onPublicName,
  onShowAmount,
}: {
  named: boolean;
  publicName: string;
  showAmount: boolean;
  onNamed: (on: boolean) => void;
  onPublicName: (value: string) => void;
  onShowAmount: (on: boolean) => void;
}) {
  return (
    <div className="g-naming">
      <label className="g-anon">
        <input type="checkbox" checked={named} onChange={(e) => onNamed(e.target.checked)} />
        {t("donate.nameMe")}
      </label>
      {named ? (
        <>
          <label className="g-field-label" htmlFor="project-public-name">{t("donate.publicName")}</label>
          <input id="project-public-name" className="g-big-input" value={publicName} maxLength={80} onChange={(e) => onPublicName(e.target.value)} />
          <p className="g-muted g-small">{t("project.publicHint")}</p>
          <label className="g-anon">
            <input type="checkbox" checked={showAmount} onChange={(e) => onShowAmount(e.target.checked)} />
            {t("donate.showAmount")}
          </label>
        </>
      ) : (
        <p className="g-muted g-small">{t("donate.asGuest")}</p>
      )}
    </div>
  );
}

function PhotoFrame({ src, alt, pending }: { src: string | null; alt: string; pending: string }) {
  if (src) return <img className="g-project-photo" src={assetUrl(src)} alt={alt} />;
  return (
    <div className="g-photo-pending" role="img" aria-label={pending}>
      <span>{pending}</span>
    </div>
  );
}

function GewerkLine({ gewerk, ccy, mine }: { gewerk: Gewerk; ccy: ReturnType<typeof parseCurrency>; mine?: number }) {
  return (
    <>
      <span className="g-gewerk-name">
        {seedText(gewerk.copyKey, "title", gewerk.title)}
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
