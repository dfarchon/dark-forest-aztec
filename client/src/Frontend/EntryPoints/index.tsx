import "../Styles/style.css";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "../Pages/App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
