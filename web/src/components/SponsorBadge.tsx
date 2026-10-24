import { API_BASE, Sponsor } from "../lib/api";
import { translate, type ScreenLang } from "../i18n";

/** "Donated by" line with optional logo. Logo alt text carries the name for screen readers. */
export function SponsorBadge({ sponsor, size = "sm", mode = "en" }: { sponsor?: Sponsor | null; size?: "sm" | "lg"; mode?: ScreenLang }) {
  if (!sponsor) return null;
  const lang = mode === "th" || mode === "de" ? mode : "en";
  const [before, after] = translate(lang, "bid.donatedBy", { name: "\u0000" }).split("\u0000");
  return (
    <p className={`sponsor sponsor-${size}`}>
      {before && <span className="muted">{before.trim()}</span>}
      {sponsor.logoUrl ? (
        <img src={`${API_BASE}${sponsor.logoUrl}`} alt={sponsor.name} className="sponsor-logo" />
      ) : null}
      <strong>{sponsor.name}</strong>
      {after?.trim() ? <span className="muted">{after.trim()}</span> : null}
    </p>
  );
}

export function KindPill({ kind }: { kind?: "voucher" | "physical" }) {
  if (kind === "physical") return <span className="pill kind-physical">Collect at desk</span>;
  return <span className="pill kind-voucher">Voucher by email</span>;
}
