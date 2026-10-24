import { brand } from "../brand";

/** Logo from the active event brand. Renders nothing when that source is blank. */
export function BrandMark(props: { kind?: "mark" | "lockup"; className?: string }) {
  const kind = props.kind ?? "mark";
  const src = kind === "lockup" ? brand.lockupSrc : brand.markSrc;
  if (!src) return null;
  const cls = `brand-mark${kind === "lockup" ? " is-lockup" : ""}${props.className ? ` ${props.className}` : ""}`;
  return <img className={cls} src={src} alt="" width={kind === "lockup" ? 299 : 32} height={kind === "lockup" ? 160 : 32} />;
}
