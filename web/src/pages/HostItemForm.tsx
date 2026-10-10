import { FormEvent, useRef, useState } from "react";
import { HostSponsor, ItemKind, LiveItem } from "../lib/api";
import { SponsorField } from "../components/SponsorField";
import { FilePreview } from "../components/FilePreview";

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

/**
 * Add an item to an existing event, or edit one. Builds the multipart body for
 * POST /api/host/events/:code/items or PATCH /api/host/events/:code/items/:itemId.
 * `pricingLocked`: the item has bids or the auction is closed — prices and type can't change.
 */
export function HostItemForm(props: {
  item?: LiveItem;
  sponsors: HostSponsor[];
  pricingLocked?: string | null;
  submitLabel: string;
  onSubmit: (form: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const { item, sponsors, pricingLocked } = props;
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "voucher");
  const [startingBid, setStartingBid] = useState(String(item?.startingBid ?? 10));
  const [minIncrement, setMinIncrement] = useState(String(item?.minIncrement ?? 5));
  const [buyNow, setBuyNow] = useState(item?.buyNow != null ? String(item.buyNow) : "");
  const [sponsorName, setSponsorName] = useState(item?.sponsor?.name ?? "");
  const [sponsorLogo, setSponsorLogo] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [voucher, setVoucher] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (sponsorLogo && !sponsorName.trim()) {
      setError("Enter the sponsor name for this logo");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("description", description.trim());
      if (!pricingLocked) {
        form.append("startingBid", String(Number(startingBid)));
        form.append("minIncrement", String(Number(minIncrement)));
        form.append("buyNow", buyNow.trim() ? String(Number(buyNow)) : "");
        form.append("kind", kind);
      }
      form.append("sponsorName", sponsorName.trim());
      if (sponsorName.trim() && sponsorLogo) form.append("sponsorLogo", sponsorLogo, sponsorLogo.name);
      if (photo) form.append("photo", photo, photo.name);
      if (!item && kind === "voucher" && voucher) form.append("voucherPdf", voucher, voucher.name);
      await props.onSubmit(form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="card nested stack" onSubmit={submit}>
      <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></label>
      <label>One-liner <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></label>
      {pricingLocked && <p className="muted">{pricingLocked}</p>}
      <label>
        Type
        <select value={kind} disabled={Boolean(pricingLocked)} onChange={(e) => setKind(e.target.value as ItemKind)}>
          <option value="voucher">Voucher (PDF emailed after payment)</option>
          <option value="physical">Physical prize (collect at the desk)</option>
        </select>
      </label>
      {item && item.kind === "voucher" && kind === "physical" && item.hasVoucher && (
        <p className="muted">Switching to physical removes the attached voucher PDF.</p>
      )}
      {!item && kind === "voucher" && (
        <label>
          Voucher PDF <span className="muted">(optional now — can be attached later)</span>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => setVoucher(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <label>
        {item?.photoUrl ? "Replace photo" : "Photo"}
        <input type="file" accept={PHOTO_ACCEPT} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      <FilePreview file={photo} />
      <SponsorField
        sponsors={sponsors}
        name={sponsorName}
        logo={sponsorLogo}
        onName={setSponsorName}
        onLogo={setSponsorLogo}
      />
      <div className="row">
        <label>Starting <input type="number" step="0.01" min="0.01" value={startingBid} disabled={Boolean(pricingLocked)} onChange={(e) => setStartingBid(e.target.value)} required /></label>
        <label>Min + <input type="number" step="0.01" min="0.01" value={minIncrement} disabled={Boolean(pricingLocked)} onChange={(e) => setMinIncrement(e.target.value)} required /></label>
        <label>Buy now <input type="number" step="0.01" value={buyNow} disabled={Boolean(pricingLocked)} onChange={(e) => setBuyNow(e.target.value)} placeholder="Optional" /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="button" disabled={busy}>{busy ? "Saving…" : props.submitLabel}</button>
        <button type="button" className="button secondary" onClick={props.onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
