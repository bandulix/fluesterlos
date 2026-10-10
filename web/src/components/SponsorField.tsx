import { useId } from "react";
import { API_BASE, HostSponsor } from "../lib/api";
import { FilePreview } from "./FilePreview";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

export function findSponsor(sponsors: HostSponsor[], name: string): HostSponsor | undefined {
  const key = name.trim().toLowerCase();
  return key ? sponsors.find((s) => s.name.toLowerCase() === key) : undefined;
}

/**
 * Sponsor name with suggestions from existing sponsors (datalist + pick chips with logos),
 * the logo on file for a matching sponsor, and an optional new logo (replaces the one on file).
 */
export function SponsorField(props: {
  sponsors: HostSponsor[];
  name: string;
  logo: File | null;
  onName: (name: string) => void;
  onLogo: (file: File | null) => void;
  disabled?: boolean;
}) {
  const { sponsors, name, logo, onName, onLogo, disabled } = props;
  const listId = useId();
  const match = findSponsor(sponsors, name);
  const typed = name.trim();
  const suggestions = typed
    ? sponsors.filter((s) => s.name.toLowerCase().includes(typed.toLowerCase()) && s !== match).slice(0, 6)
    : sponsors.slice(0, 8);
  return (
    <div className="sponsor-field stack">
      <div className="row">
        <label>
          Sponsor
          <input
            value={name}
            list={listId}
            disabled={disabled}
            onChange={(e) => onName(e.target.value)}
            placeholder={sponsors.length ? "Type or pick below (optional)" : "Optional"}
            autoComplete="off"
          />
        </label>
        <label>
          Sponsor logo {match?.logoUrl ? <span className="muted">(replaces the one on file)</span> : null}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            disabled={disabled}
            onChange={(e) => onLogo(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <datalist id={listId}>
        {sponsors.map((sp) => (
          <option key={sp.id} value={sp.name} />
        ))}
      </datalist>
      {suggestions.length > 0 && !disabled && (
        <div className="row sponsor-picks" aria-label="Existing sponsors">
          {suggestions.map((sp) => (
            <button type="button" key={sp.id} className="chip" onClick={() => onName(sp.name)} title={`Use ${sp.name}`}>
              {sp.logoUrl && <img src={`${API_BASE}${sp.logoUrl}`} alt="" className="sponsor-logo" />}
              <span>{sp.name}</span>
            </button>
          ))}
        </div>
      )}
      {(logo || match) && (
        <div className="sponsor sponsor-sm">
          {logo ? (
            <FilePreview file={logo} className="sponsor-logo" />
          ) : match?.logoUrl ? (
            <img src={`${API_BASE}${match.logoUrl}`} alt={match.name} className="sponsor-logo" />
          ) : null}
          <span className="muted">
            {match
              ? logo
                ? `Existing sponsor “${match.name}” — new logo will replace the current one`
                : match.logoUrl
                  ? `Existing sponsor “${match.name}” — logo on file`
                  : `Existing sponsor “${match.name}” — no logo yet`
              : typed
                ? `New sponsor “${typed}”`
                : "Enter the sponsor name for this logo"}
          </span>
        </div>
      )}
    </div>
  );
}
