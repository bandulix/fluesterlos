import { Link, Navigate, Route, Routes } from "react-router-dom";
import { HostAuthProvider, useHostAuth } from "./lib/hostAuth";
import { HostPage } from "./pages/HostPage";

/** Host / landing area — lazy-loaded, so guests never download host code. */
export default function HostShell() {
  return (
    <HostAuthProvider>
      <HostTopbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </HostAuthProvider>
  );
}

function HostTopbar() {
  const { auth, logout } = useHostAuth();
  return (
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
