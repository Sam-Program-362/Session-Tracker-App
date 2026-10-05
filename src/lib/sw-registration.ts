"use client";

import { useEffect, useRef } from "react";

/**
 * Register the app's service worker once, on the client.
 *
 * We deliberately keep this low-drama:
 *  - If service workers are unsupported, we silently do nothing.
 *  - If the SW fails to fetch/update, the app still works (it's not a gate).
 *  - We only try once per page load to avoid spamming the console.
 *
 * This function must only ever run in a browser. Next.js static generation
 * can otherwise try to evaluate "use client" components on the server, where
 * React hooks like useRef are not available.
 */
export function useServiceWorker(): void {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    if (typeof window === "undefined") {
      return;
    }

    const nav = window.navigator as Navigator & {
      serviceWorker?: ServiceWorkerContainer;
    };
    const container = nav.serviceWorker;
    if (!container?.register) {
      return;
    }

    void container
      .register("/sw.js", { type: "classic" })
      .then(
        (registration: ServiceWorkerRegistration) => {
          // Keep the console quiet by default; a real app would show an "update"
          // button here. For now we just log the expected outcome at debug level.
          console.debug("[Session Tracker] service worker ready", registration.scope);
        },
        (error: unknown) => {
          // Not fatal: the app still runs over the network.
          console.debug("[Session Tracker] service worker registration skipped", error);
        }
      )
      .catch((error: unknown) => {
        console.debug("[Session Tracker] service worker registration failed", error);
      });
  }, []);
}

/**
 * Bare registration call for use from a plain effect without React hooks.
 * This is the function Next.js static generation should hit, not the hook.
 */
export function registerServiceWorkerOnce(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof window.navigator === "undefined") {
    return;
  }
  const nav = window.navigator as Navigator & {
    serviceWorker?: ServiceWorkerContainer;
  };
  const container = nav.serviceWorker;
  if (!container?.register) {
    return;
  }
  if ((window as unknown as Record<string, unknown>).__STT_SW_REGISTERED__) {
    return;
  }
  (window as unknown as Record<string, unknown>).__STT_SW_REGISTERED__ = true;

  void container
    .register("/sw.js", { type: "classic" })
    .then(
      (registration: ServiceWorkerRegistration) => {
        console.debug("[Session Tracker] service worker ready", registration.scope);
      },
      (error: unknown) => {
        console.debug("[Session Tracker] service worker registration skipped", error);
      }
    )
    .catch((error: unknown) => {
      console.debug("[Session Tracker] service worker registration failed", error);
    });
}
