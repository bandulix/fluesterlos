const envApi = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE = (envApi && envApi.length > 0) ? envApi.replace(/\/$/, "") : "";

export type Sponsor = { id: string; name: string; logoUrl: string | null };
export type ItemKind = "voucher" | "physical";

export type LivePayload = {
  event: {
    id: string;
    code: string;
    title: string;
    startsAt: string;
    endsAt: string;
    status: "scheduled" | "open" | "closed";
    currency: "USD" | "EUR" | "THB";
    joinUrl: string;
    /** IANA zone used to enter and show times for this event (default Asia/Bangkok). */
    timezone?: string;
    closedEarly?: boolean;
  };
  items: Array<{
    id: string;
    title: string;
    description: string;
    photoUrl: string | null;
    startingBid: number;
    minIncrement: number;
    buyNow: number | null;
    /** Retail value of the prize (shown to guests as "Value ฿X"). */
    retailValue?: number | null;
    soldViaBuyNow?: boolean;
    sortOrder: number;
    highBid: number;
    highBidder: string | null;
    /** Opaque key of the current leader; compare with GET /me leaderKey. */
    leaderKey?: string | null;
    bidCount: number;
    hasVoucher?: boolean;
    kind?: ItemKind;
    sponsor?: Sponsor | null;
  }>;
  stats: {
    guestCount: number;
    totalHighBids: number;
    totalBids: number;
    itemCount: number;
    /** Items with at least one bid (the total counts only these). */
    itemsWithBids?: number;
  };
  recentBids: Array<{
    itemId?: string;
    amount: number;
    createdAt: string;
    itemTitle: string;
    guestName: string;
  }>;
  serverNow: string;
};

export type HostGuest = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  joined?: boolean;
  bidCount: number;
  createdAt: string;
};

export type HostAccount = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
};

export type HostEventSummary = {
  id: string;
  code: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  status: "scheduled" | "open" | "closed";
  currency: "USD" | "EUR" | "THB";
  itemCount: number;
  guestCount: number;
  joinUrl: string;
  timezone?: string;
  closedEarlyAt?: string | null;
  closedBy?: string | null;
  paidInvoiceCount?: number;
};

export type InvoiceDto = {
  id: string;
  eventId: string;
  guestId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone?: string | null;
  total: number;
  status: "unpaid" | "payslip_uploaded" | "paid";
  payslipPath: string | null;
  paidAt: string | null;
  vouchersEmailedAt: string | null;
  createdAt: string;
  lines: Array<{
    itemId: string;
    title: string;
    description: string;
    amount: number;
    hasVoucher?: boolean;
  }>;
};

function guestTokenKey(code: string) {
  return `fl_guest_${code.toLowerCase()}`;
}

export function getGuestToken(code: string) {
  return localStorage.getItem(guestTokenKey(code));
}

export function setGuestToken(code: string, token: string) {
  localStorage.setItem(guestTokenKey(code), token);
}

export function clearGuestToken(code: string) {
  localStorage.removeItem(guestTokenKey(code));
}

export type GuestMe = {
  guest: null | { id: string; name: string; nameSet?: boolean; email: string | null; phone: string | null; token?: string };
  leaderKey?: string;
  bidItemIds?: string[];
};

export type LiveItem = LivePayload["items"][number];

/** "…5678" — enough for a guest to recognise their own number on a shared screen. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : "";
}

export async function api<T>(path: string, init: RequestInit = {}, guestToken?: string | null): Promise<T> {
  const headers = new Headers(init.headers || {});
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body && !isForm) {
    headers.set("Content-Type", "application/json");
  }
  if (guestToken) headers.set("X-Guest-Token", guestToken);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error(res.statusText || "Request failed");
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : (data as { error?: string }).error?.toString?.()) || res.statusText,
    );
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { body?: unknown }).body = data;
    throw err;
  }
  return data as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(res.statusText || "Download failed");
  return res.blob();
}

/** Multipart upload helper (do not set Content-Type — browser sets boundary). */
export async function uploadForm<T>(
  path: string,
  form: FormData,
  guestToken?: string | null,
  method: "POST" | "PATCH" | "PUT" = "POST",
): Promise<T> {
  const headers = new Headers();
  if (guestToken) headers.set("X-Guest-Token", guestToken);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: form,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error?.toString?.() || res.statusText);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { body?: unknown }).body = data;
    throw err;
  }
  return data as T;
}

export type LoginRequest = {
  id: string;
  code: string;
  delivery: "email" | "desk";
  guestName: string;
  phone: string | null;
  email: string | null;
  attempts: number;
  requestedAt: string;
  expiresAt: string;
};

export type HostSponsor = Sponsor & { itemCount: number };

/** API-relative asset path → URL (absolute URLs pass through). */
export function assetUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  return u.startsWith("/") ? `${API_BASE}${u}` : u;
}
