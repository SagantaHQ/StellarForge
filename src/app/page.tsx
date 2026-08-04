"use client";

import { useEffect } from "react";
import { IdeShell } from "@/components/ide/ide-shell";

export default function Home() {
  // Register service worker for PWA + offline shell
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("SW registration failed:", err));
    }
  }, []);

  return <IdeShell />;
}
