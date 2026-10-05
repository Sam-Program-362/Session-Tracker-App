// Client-side auth helper.
//
// The app is local-first: the session is checked once against the network and
// then cached on the device, so the user only needs internet the first time
// they sign in. Everything after that works offline.

import { createAuthClient } from "better-auth/react";

const CACHE_KEY = "session-tracker:signed-in";

let client: ReturnType<typeof createAuthClient> | null = null;

/**
 * Built on first use, never at import time.
 *
 * The page is statically prerendered, so touching the client during module
 * evaluation would run it on the server where there is no origin to resolve
 * "/api/auth" against.
 */
function getClient() {
  if (!client) {
    client = createAuthClient();
  }
  return client;
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Read the locally cached "is signed in" flag. */
export function isCachedSignedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCachedSignedIn(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(CACHE_KEY, "1");
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // A private-mode browser may refuse localStorage. The session cookie
    // still works; only the offline shortcut is lost.
  }
}

function readError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message ?? "");
    if (message) return message;
  }
  return fallback;
}

export async function signIn(
  email: string,
  password: string
): Promise<SignInResult> {
  try {
    const { error } = await getClient().signIn.email({ email, password });
    if (error) {
      return {
        ok: false,
        error: error.message || "That email and password did not match.",
      };
    }
    setCachedSignedIn(true);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}

export async function signUp(
  email: string,
  password: string,
  name: string
): Promise<SignInResult> {
  try {
    const { error } = await getClient().signUp.email({ email, password, name });
    if (error) {
      return {
        ok: false,
        error: error.message || "That account could not be created.",
      };
    }
    setCachedSignedIn(true);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Resolve the current sign-in state.
 *
 * Offline: falls back to the cached flag so the app still opens.
 * Online: refreshes the flag from the real session cookie.
 */
export async function resolveSignedIn(): Promise<boolean> {
  try {
    const { data } = await getClient().getSession();
    const signedIn = Boolean(data?.user?.id);
    setCachedSignedIn(signedIn);
    return signedIn;
  } catch {
    return isCachedSignedIn();
  }
}

export async function signOut(): Promise<void> {
  try {
    await getClient().signOut();
  } catch {
    // Offline sign-out still clears the local flag below.
  }
  setCachedSignedIn(false);
}
