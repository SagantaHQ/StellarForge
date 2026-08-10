"use client";

import { useEffect, useState } from "react";

/**
 * ClientOnly — renders children only after hydration (on the client).
 *
 * Use this to wrap components that must NOT be SSR'd (e.g. Web Components
 * that set data-* attributes differently on server vs client, causing
 * hydration mismatches).
 *
 * During SSR + the first client render, returns null.
 * After mount, renders the children.
 */
export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return <>{children}</>;
}
