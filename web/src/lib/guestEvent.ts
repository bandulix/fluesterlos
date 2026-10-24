import { useEffect, useState } from "react";
import { brand } from "../brand";
import { api } from "./api";

export function guestCodeFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/e\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function useGuestEventTitle(code: string | null) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!code) {
      setTitle("");
      return;
    }
    let cancelled = false;
    api<{ event: { title: string } }>(`/api/events/${code}`)
      .then((d) => {
        if (!cancelled) setTitle(d.event.title);
      })
      .catch(() => {
        if (!cancelled) setTitle("");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const prev = document.title;
    if (title) document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);

  useEffect(() => {
    if (!code || !title) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const prevHref = link?.href;
    // The manifest is served from a blob: URL, so every URL in it must be absolute —
    // relative start_url / icon src resolve against "blob:" and browsers reject them.
    const origin = window.location.origin;
    const manifest = buildGuestManifest(origin, code, title);
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const url = URL.createObjectURL(blob);
    if (link) link.href = url;
    return () => {
      URL.revokeObjectURL(url);
      if (link && prevHref) link.href = prevHref;
    };
  }, [code, title]);

  return title;
}

export function buildGuestManifest(origin: string, code: string, title: string) {
  return {
    id: `${origin}/e/${code}`,
    name: title,
    short_name: title.slice(0, 24),
    description: title,
    start_url: `${origin}/e/${encodeURIComponent(code)}/bid`,
    scope: `${origin}/`,
    display: "standalone",
    theme_color: brand.themeColor,
    background_color: brand.backgroundColor,
    icons: [
      { src: `${origin}${brand.icon192}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${origin}${brand.icon512}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${origin}${brand.icon512}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
