import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { brand } from "./brand";
import { UpdateBanner } from "./components/UpdateBanner";
import { initLanguage } from "./i18n";
import { LanguageRoot } from "./i18n/react";
import { registerServiceWorker } from "./lib/swUpdate";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "./styles.css";

initLanguage();
document.documentElement.dataset.theme = brand.id;

if (import.meta.env.PROD) registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageRoot>
      <BrowserRouter>
        <App />
        <UpdateBanner />
      </BrowserRouter>
    </LanguageRoot>
  </React.StrictMode>,
);
