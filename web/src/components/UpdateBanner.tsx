import { useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { isUpdateReady, showsUpdateBanner, subscribeUpdate } from "../lib/swUpdate";

/** Host pages only: a new version took over while the host had unsaved input (it also reloads by itself once the input is gone). */
export function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, isUpdateReady, () => false);
  const { pathname } = useLocation();
  if (!ready || !showsUpdateBanner(pathname)) return null;
  return (
    <div className="update-banner" role="status">
      <span>Update available — it reloads automatically once you've saved; or reload now.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
