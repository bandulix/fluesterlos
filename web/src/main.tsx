import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { HostAuthProvider } from "./lib/hostAuth";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <HostAuthProvider>
        <App />
      </HostAuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
