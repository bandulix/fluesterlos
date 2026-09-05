import { Link, Route, Routes } from "react-router-dom";
import { HostPage } from "./pages/HostPage";
import { JoinPage } from "./pages/JoinPage";
import { BidPage } from "./pages/BidPage";
import { StatsPage } from "./pages/StatsPage";
import { EngagerPage } from "./pages/EngagerPage";
import { InvoicePage } from "./pages/InvoicePage";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">FlüsterLos</Link>
        <nav>
          <Link to="/host">Host</Link>
        </nav>
      </header>
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
  return (
    <section className="card hero">
      <h1>Silent auction, self-hosted</h1>
      <p>QR → PWA → bid. Everyone sees the live board — and the big screen keeps the room bidding.</p>
      <p><Link className="button" to="/host">Open host setup</Link></p>
    </section>
  );
}
