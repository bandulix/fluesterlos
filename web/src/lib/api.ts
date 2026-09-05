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
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (guestToken) headers.set("X-Guest-Token", guestToken);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error?.toString?.() || res.statusText);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { body?: unknown }).body = data;
    throw err;
  }
  return data as T;
}
