/**
 * main.tsx
 *
 * Punto de entrada de la aplicación React.
 * Monta <App /> en el div#root definido en index.html.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("No se encontró #root en el DOM.");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
