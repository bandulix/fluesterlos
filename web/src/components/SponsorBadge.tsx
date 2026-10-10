import { API_BASE, Sponsor } from "../lib/api";

/** "Donated by" line with optional logo. Logo alt text carries the name for screen readers. */
export function SponsorBadge({ sponsor, size = "sm" }: { sponsor?: Sponsor | null; size?: "sm" | "lg" }) {
  if (!sponsor) return null;
  return (
    <p className={`sponsor sponsor-${size}`}>
      <span className="muted">Donated by</span>
      {sponsor.logoUrl ? (
        <img src={`${API_BASE}${sponsor.logoUrl}`} alt={sponsor.name} className="sponsor-logo" />
      ) : null}
      <strong>{sponsor.name}</strong>
    </p>
  );
}

export function KindPill({ kind }: { kind?: "voucher" | "physical" }) {
  if (kind === "physical") return <span className="pill kind-physical">Collect at desk</span>;
  return <span className="pill kind-voucher">Voucher by email</span>;
}
