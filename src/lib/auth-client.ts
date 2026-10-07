// Client-side auth helper.
//
// The app is local-first: the session is checked once against the network and
// then cached on the device, so the user only needs internet the first time
// they sign in. Everything after that works offline.

import { createAuthClient } from "better-auth/react";

const CACHE_KEY = "session-tracker:signed-in";
const USER_ID_KEY = "session-tracker:user-id";

/**
 * How long a background session check may take before it is treated as
 * inconclusive. A slow network must never be read as "signed out".
 */
const SESSION_TIMEOUT_MS = 8_000;

/**
 * What the server told us about the session.
 *
 * - "valid"   — a real session came back; this device's account is confirmed.
 * - "invalid" — the server clearly answered "nobody is signed in" (401 or an
 *               empty session body). The local data keeps working.
 * - "unknown" — no answer: offline, timed out, or a server/internal error.
 *               The device stays signed in.
 */
export type SessionCheck = "valid" | "invalid" | "unknown";

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

/** Remember which account owns this device, so it works offline too. */
function setCachedUserId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(USER_ID_KEY, id);
    else window.localStorage.removeItem(USER_ID_KEY);
  } catch {
    // A private-mode browser may refuse localStorage; the id is then only
    // available while online, which is enough to claim records.
  }
}

/** The account id remembered on this device (null before the first sign-in). */
export function getCachedUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Has this device ever signed in?
 *
 * The cached account id is the signal that matters, so the answer is known
 * without touching the network and a returning user never sees the form
 * again. The older boolean flag is still honoured so devices that only have
 * that flag are not asked to sign in a second time.
 */
export function hasSignedInBefore(): boolean {
  return getCachedUserId() !== null || isCachedSignedIn();
}

/** The user id inside a sign-in / get-session response, if there is one. */
function extractUserId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const user = (data as { user?: { id?: unknown } }).user;
  return typeof user?.id === "string" && user.id.length > 0 ? user.id : null;
}

/** A numeric HTTP status on a Better Auth error object, or null. */
function readStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Remember both halves of "this device belongs to that account". */
function rememberSignedInUser(data: unknown): void {
  const id = extractUserId(data);
  if (id) setCachedUserId(id);
  setCachedSignedIn(true);
}

/** Forget this device's account. Only ever used when the user logs out. */
export function clearCachedUser(): void {
  setCachedUserId(null);
  setCachedSignedIn(false);
}

/**
 * The signed-in user's id. Online it comes from the session cookie and is
 * cached; offline it falls back to the id remembered on this device.
 */
export async function getSignedInUserId(): Promise<string | null> {
  try {
    const { data } = await getClient().getSession();
    const id = data?.user?.id ?? null;
    setCachedUserId(id);
    return id;
  } catch {
    return getCachedUserId();
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
    const { data, error } = await getClient().signIn.email({ email, password });
    if (error) {
      return {
        ok: false,
        error: error.message || "That email and password did not match.",
      };
    }
    rememberSignedInUser(data);
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
    const { data, error } = await getClient().signUp.email({ email, password, name });
    if (error) {
      return {
        ok: false,
        error: error.message || "That account could not be created.",
      };
    }
    rememberSignedInUser(data);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Ask the server about the session, in the background.
 *
 * Only a clear answer is allowed to change what we believe:
 *   - offline, a timeout, a thrown request or a server error all return
 *     "unknown", so the app keeps opening on the cached account with its
 *     local data intact;
 *   - a 401 or an empty session body returns "invalid", which is the one
 *     case where the sign-in form is shown.
 */
export async function verifySession(): Promise<SessionCheck> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "unknown";
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), SESSION_TIMEOUT_MS);
  });

  // Never rejects: a failed request is an answer too, it just is not a
  // verdict, and it must not surface as an unhandled rejection when the
  // timeout wins the race.
  const call = (async () => {
    try {
      const { data, error } = await getClient().getSession();
      return { kind: "answer" as const, data, error };
    } catch {
      return { kind: "network" as const, data: null, error: null };
    }
  })();

  const result = await Promise.race([call, timeout]);
  if (timer) clearTimeout(timer);

  if (result.kind !== "answer") return "unknown";

  if (result.error) {
    // Only a 401 means the session is really gone.
    return readStatus(result.error) === 401 ? "invalid" : "unknown";
  }

  const id = extractUserId(result.data);
  if (id) {
    setCachedUserId(id);
    setCachedSignedIn(true);
    return "valid";
  }

  // The server answered, and the answer was "nobody is signed in": drop the
  // cached account so the sign-in form becomes available again.
  clearCachedUser();
  return "invalid";
}

export async function signOut(): Promise<void> {
  try {
    await getClient().signOut();
  } catch {
    // Offline sign-out still clears the device below.
  }
  clearCachedUser();
}
