import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { brand } from "./brand";
import { UpdateBanner } from "./components/UpdateBanner";
import { registerServiceWorker } from "./lib/swUpdate";
import "./styles.css";

document.documentElement.dataset.theme = brand.id;

if (import.meta.env.PROD) registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <UpdateBanner />
    </BrowserRouter>
  </React.StrictMode>,
);
