import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";
import { SwitchConfirm } from "./SwitchConfirm";

/** Small "⋯" menu in the header: who am I, change board name, switch number (with inline confirm). */
export function GuestMenu({
  who,
  payHref,
  onChangeName,
  onSwitch,
}: {
  who: string;
  payHref?: string;
  onChangeName?: () => void;
  onSwitch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="g-menu" ref={ref}>
      <button
        type="button"
        className="g-menu-btn"
        aria-label={t("menu.open")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="g-menu-panel" role="menu">
          <p className="g-menu-who">
            <span>{t("menu.biddingAs")}</span>
            <strong>{who}</strong>
          </p>
          {payHref && (
            <Link role="menuitem" className="g-menu-item" to={payHref} onClick={() => setOpen(false)}>
              {t("menu.pay")}
            </Link>
          )}
          {onChangeName && (
            <button
              type="button"
              role="menuitem"
              className="g-menu-item"
              onClick={() => {
                setOpen(false);
                onChangeName();
              }}
            >
              {t("menu.changeName")}
            </button>
          )}
          {confirming ? (
            <SwitchConfirm onYes={onSwitch} onNo={() => setConfirming(false)} />
          ) : (
            <button type="button" role="menuitem" className="g-menu-item" onClick={() => setConfirming(true)}>
              {t("menu.switch")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
