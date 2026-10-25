import { useId } from "react";
import { API_BASE, HostSponsor } from "../lib/api";
import { FilePreview } from "./FilePreview";
import { DraftSponsor, findDraftSponsor } from "../lib/sponsorDrafts";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

export function findSponsor(sponsors: HostSponsor[], name: string): HostSponsor | undefined {
  const key = name.trim().toLowerCase();
  return key ? sponsors.find((s) => s.name.toLowerCase() === key) : undefined;
}

/**
 * Sponsor name with suggestions from existing sponsors (datalist + pick chips with logos),
 * the logo on file for a matching sponsor, and an optional new logo (replaces the one on file).
 * `drafts` are sponsors typed for earlier items of the same unsaved form: suggested too, and their
 * chosen logo is previewed/reused.
 */
export function SponsorField(props: {
  sponsors: HostSponsor[];
  name: string;
  logo: File | null;
  onName: (name: string) => void;
  onLogo: (file: File | null) => void;
  disabled?: boolean;
  drafts?: DraftSponsor[];
}) {
  const { sponsors, name, logo, onName, onLogo, disabled, drafts = [] } = props;
  const listId = useId();
  const match = findSponsor(sponsors, name);
  const draftMatch = findDraftSponsor(drafts, name);
  const typed = name.trim();
  const lc = typed.toLowerCase();
  // Draft sponsors first (most likely to be repeated), then saved ones not shadowed by a draft.
  const draftPicks = drafts.filter((d) => d !== draftMatch && (!lc || d.name.toLowerCase().includes(lc)));
  const savedPicks = sponsors.filter(
    (s) => s !== match && !findDraftSponsor(drafts, s.name) && (!lc || s.name.toLowerCase().includes(lc)),
  );
  const suggestions = savedPicks.slice(0, Math.max(0, (typed ? 6 : 8) - draftPicks.length));
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
        <div>
          <span>Sponsor logo {match?.logoUrl ? <span className="muted">(replaces the one on file)</span> : null}</span>
          <label className="file-btn">
            <span>{logo ? logo.name : "Choose logo"}</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              disabled={disabled}
              onChange={(e) => onLogo(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      </div>
      <datalist id={listId}>
        {drafts.map((d) => (
          <option key={`draft-${d.name}`} value={d.name} />
        ))}
        {sponsors
          .filter((sp) => !findDraftSponsor(drafts, sp.name))
          .map((sp) => (
            <option key={sp.id} value={sp.name} />
          ))}
      </datalist>
      {(suggestions.length > 0 || draftPicks.length > 0) && !disabled && (
        <div className="row sponsor-picks" aria-label="Sponsors">
          {draftPicks.map((d) => (
            <button
              type="button"
              key={`draft-${d.name}`}
              className="chip"
              onClick={() => onName(d.name)}
              title={`Use ${d.name} (from item ${d.fromItem + 1})`}
            >
              {d.logo ? <FilePreview file={d.logo} className="sponsor-logo" /> : findSponsor(sponsors, d.name)?.logoUrl ? (
                <img src={`${API_BASE}${findSponsor(sponsors, d.name)!.logoUrl}`} alt="" className="sponsor-logo" />
              ) : null}
              <span>{d.name}</span>
            </button>
          ))}
          {suggestions.map((sp) => (
            <button type="button" key={sp.id} className="chip" onClick={() => onName(sp.name)} title={`Use ${sp.name}`}>
              {sp.logoUrl && <img src={`${API_BASE}${sp.logoUrl}`} alt="" className="sponsor-logo" />}
              <span>{sp.name}</span>
            </button>
          ))}
        </div>
      )}
      {(logo || match || draftMatch) && (
        <div className="sponsor sponsor-sm">
          {logo ? (
            <FilePreview file={logo} className="sponsor-logo" />
          ) : draftMatch?.logo ? (
            <FilePreview file={draftMatch.logo} className="sponsor-logo" />
          ) : match?.logoUrl ? (
            <img src={`${API_BASE}${match.logoUrl}`} alt={match.name} className="sponsor-logo" />
          ) : null}
          <span className="muted">
            {draftMatch && !logo
              ? draftMatch.logo
                ? `Same sponsor as item ${draftMatch.fromItem + 1} — reuses the logo chosen there`
                : match?.logoUrl
                  ? `Same sponsor as item ${draftMatch.fromItem + 1} — logo on file`
                  : `Same sponsor as item ${draftMatch.fromItem + 1}`
              : match
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
