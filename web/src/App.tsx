import { lazy, ReactNode, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { JoinPage } from "./pages/JoinPage";
import { BidPage } from "./pages/BidPage";
import { guestCodeFromPath, useGuestEventTitle } from "./lib/guestEvent";

// Guests get only the join + bid screens up front; everything else loads on demand.
const HostShell = lazy(() => import("./HostShell"));
const InvoicePage = lazy(() => import("./pages/InvoicePage").then((m) => ({ default: m.InvoicePage })));
const StatsPage = lazy(() => import("./pages/StatsPage").then((m) => ({ default: m.StatsPage })));
const EngagerPage = lazy(() => import("./pages/EngagerPage").then((m) => ({ default: m.EngagerPage })));

const Guest = ({ children }: { children: ReactNode }) => <main className="g-main">{children}</main>;

export default function App() {
  const location = useLocation();
  useGuestEventTitle(guestCodeFromPath(location.pathname));

  return (
    <div className="app">
      <Suspense fallback={<p className="g-loading" role="status">Loading…</p>}>
        <Routes>
          <Route path="/e/:code" element={<Guest><JoinPage /></Guest>} />
          <Route path="/e/:code/bid" element={<Guest><BidPage /></Guest>} />
          <Route path="/e/:code/invoice" element={<Guest><InvoicePage /></Guest>} />
          <Route path="/e/:code/stats" element={<main><StatsPage /></main>} />
          <Route path="/e/:code/engager" element={<main><EngagerPage /></main>} />
          <Route path="*" element={<HostShell />} />
        </Routes>
      </Suspense>
    </div>
  );
}
