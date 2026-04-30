import React from "react";
import { createRoot } from "react-dom/client";

import { PopupApp } from "@/features/popup/popup-app";
import "@/styles/ui.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);

