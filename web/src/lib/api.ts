const envApi = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE = (envApi && envApi.length > 0) ? envApi.replace(/\/$/, "") : "";

export type LivePayload = {
  event: {
    id: string;
    code: string;
    title: string;
    startsAt: string;
    endsAt: string;
    status: "scheduled" | "open" | "closed";
    joinUrl: string;
  };
  items: Array<{
    id: string;
    title: string;
    description: string;
    photoUrl: string | null;
    startingBid: number;
    minIncrement: number;
    buyNow: number | null;
    sortOrder: number;
    highBid: number;
    highBidder: string | null;
    bidCount: number;
    hasVoucher?: boolean;
  }>;
  stats: {
    guestCount: number;
    totalHighBids: number;
    totalBids: number;
    itemCount: number;
  };
  recentBids: Array<{
    amount: number;
    createdAt: string;
    itemTitle: string;
    guestName: string;
  }>;
  serverNow: string;
};

export type InvoiceDto = {
  id: string;
  eventId: string;
  guestId: string;
  guestName: string;
  guestEmail: string;
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
): Promise<T> {
  const headers = new Headers();
  if (guestToken) headers.set("X-Guest-Token", guestToken);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
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
