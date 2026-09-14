import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/i18n";
import App from "./App";
import SingleDocumentWindow from "./SingleDocumentWindow";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html");

const query = new URLSearchParams(window.location.search);
const root = query.get("root");
const file = query.get("file");
const documentOnly = query.get("view") === "document" && root !== null && file !== null;

createRoot(container).render(
  <StrictMode>
    {documentOnly ? <SingleDocumentWindow root={root} file={file} /> : <App />}
  </StrictMode>,
);
