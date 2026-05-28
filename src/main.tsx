import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { App } from "@/App";
import { LensDesigner } from "@/components/LensDesigner";
import { PdMeasurement } from "@/components/PdMeasurement";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/designer" element={<LensDesigner />} />
        <Route path="/pupillary-distance" element={<PdMeasurement />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
