import React from "react";
import { createRoot } from "react-dom/client";

import { ToolboxApp } from "@/features/toolbox/toolbox-app";
import "@/styles/ui.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToolboxApp />
  </React.StrictMode>
);

