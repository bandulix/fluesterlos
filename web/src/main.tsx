import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { HostAuthProvider } from "./lib/hostAuth";
import { UpdateBanner } from "./components/UpdateBanner";
import { registerServiceWorker } from "./lib/swUpdate";
import "./styles.css";

if (import.meta.env.PROD) registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <HostAuthProvider>
        <App />
        <UpdateBanner />
      </HostAuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
