import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { IndexerProvider } from "./contexts/IndexerContext";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <IndexerProvider>
        <App />
      </IndexerProvider>
    </BrowserRouter>
  </StrictMode>
);
