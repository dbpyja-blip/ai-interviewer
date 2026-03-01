import { CloudProvider } from "@/cloud/useCloud";
import "@livekit/components-styles/components/participant";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
      const shouldUseDark = stored === "dark";
      const root = document.documentElement;
      if (shouldUseDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    } catch (_) {
      // ignore storage errors
    }
  }, []);

  return (
    <CloudProvider>
      <Component {...pageProps} />
    </CloudProvider>
  );
}
