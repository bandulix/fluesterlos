import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HostPage } from "./pages/HostPage";
import { JoinPage } from "./pages/JoinPage";
import { BidPage } from "./pages/BidPage";
import { StatsPage } from "./pages/StatsPage";
import { EngagerPage } from "./pages/EngagerPage";
import { InvoicePage } from "./pages/InvoicePage";
import { useHostAuth } from "./lib/hostAuth";
import { guestCodeFromPath, useGuestEventTitle } from "./lib/guestEvent";

export default function App() {
  const { auth, logout } = useHostAuth();
  const location = useLocation();
  const guestCode = guestCodeFromPath(location.pathname);
  useGuestEventTitle(guestCode);

  return (
    <div className="app">
      {!guestCode && (
        <header className="topbar">
          <Link to={auth?.authenticated ? "/host" : "/"} className="brand">FlüsterLos</Link>
          <nav>
            {auth?.authenticated ? (
              <>
                <Link to="/host">Auctions</Link>
                <span className="session">{auth.email}</span>
                <button type="button" className="button secondary" onClick={() => logout().catch(() => undefined)}>
                  Log out
                </button>
              </>
            ) : (
              <Link to="/host">Host login</Link>
            )}
          </nav>
        </header>
      )}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/e/:code" element={<JoinPage />} />
          <Route path="/e/:code/bid" element={<BidPage />} />
          <Route path="/e/:code/invoice" element={<InvoicePage />} />
          <Route path="/e/:code/stats" element={<StatsPage />} />
          <Route path="/e/:code/engager" element={<EngagerPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Home() {
  const { auth } = useHostAuth();
  if (auth === null) return <p className="muted">Loading…</p>;
  if (auth.authenticated) return <Navigate to="/host" replace />;
  return (
    <section className="card hero">
      <h1>Silent auction, self-hosted</h1>
      <p>QR → PWA → bid. Everyone sees the live board — and the big screen keeps the room bidding.</p>
      <p><Link className="button" to="/host">Host login</Link></p>
    </section>
  );
}
