/**
 * Remembers the "enter your 6-digit code" step while the guest switches apps (to read the email,
 * or walks to the desk). Mobile browsers often discard a backgrounded tab; without this the guest
 * came back to an empty phone field. Kept in localStorage (survives tab discard) with a short expiry.
 */
export type PendingJoin = { phone: string; via: "email" | "desk"; email: string | null; ts: number };

export const PENDING_JOIN_TTL_MS = 15 * 60_000;
const key = (code: string) => `fl_pending_join_${code.toLowerCase()}`;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function savePendingJoin(code: string, p: Omit<PendingJoin, "ts">, now = Date.now()): void {
  try {
    store()?.setItem(key(code), JSON.stringify({ ...p, ts: now }));
  } catch {
    /* private mode / quota: the flow still works, it just isn't restored */
  }
}

export function loadPendingJoin(code: string, now = Date.now()): PendingJoin | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key(code));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingJoin>;
    const valid =
      typeof p.phone === "string" && p.phone && (p.via === "email" || p.via === "desk") && typeof p.ts === "number";
    if (!valid || now - p.ts! > PENDING_JOIN_TTL_MS || p.ts! > now + 60_000) {
      s.removeItem(key(code));
      return null;
    }
    return { phone: p.phone!, via: p.via!, email: typeof p.email === "string" ? p.email : null, ts: p.ts! };
  } catch {
    return null;
  }
}

export function clearPendingJoin(code: string): void {
  try {
    store()?.removeItem(key(code));
  } catch {
    /* ignore */
  }
}
