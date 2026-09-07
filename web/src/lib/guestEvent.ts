import { useEffect, useState } from "react";
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
    const manifest = {
      name: title,
      short_name: title.slice(0, 24),
      description: title,
      start_url: `/e/${code}/bid`,
      display: "standalone",
      theme_color: "#070b16",
      background_color: "#0b1220",
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    };
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
