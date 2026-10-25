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
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-ext-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-ext-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-ext-800.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "@fontsource/barlow-condensed/latin-ext-800-italic.css";
import "@fontsource/kanit/latin-400.css";
import "@fontsource/kanit/thai-400.css";
import "@fontsource/kanit/latin-600.css";
import "@fontsource/kanit/thai-600.css";
import "@fontsource/kanit/latin-700.css";
import "@fontsource/kanit/thai-700.css";
import "./screenFonts.css";
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
