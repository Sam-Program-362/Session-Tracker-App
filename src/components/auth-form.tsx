"use client";

import { useState } from "react";
import { CapsuleButton } from "./capsule-button";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "signin" | "signup";

/**
 * The pill-styled sign in / create account form.
 *
 * Presented inline on Screen 1 so it matches the rest of the app: same rounded
 * card, same capsule buttons, same soft shadows, no new visual language.
 */
export function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "signup";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (isSignUp && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setBusy(true);
    setError(null);

    const result = isSignUp
      ? await signUp(trimmedEmail, password, name.trim() || trimmedEmail)
      : await signIn(trimmedEmail, password);

    setBusy(false);

    if (result.ok) {
      onDone();
      return;
    }
    setError(result.error);
  }

  return (
    <form
      onSubmit={submit}
      className="mt-7 rounded-3xl border border-border/50 bg-white p-5 shadow-soft"
    >
      {/* Mode switch */}
      <div className="flex gap-2" role="tablist" aria-label="Account">
        <ModePill
          label="Sign in"
          active={!isSignUp}
          onClick={() => switchMode("signin")}
        />
        <ModePill
          label="Create account"
          active={isSignUp}
          onClick={() => switchMode("signup")}
        />
      </div>

      <div className="mt-5 flex flex-col gap-3.5">
        {isSignUp ? (
          <Field
            id="auth-name"
            label="Name"
            type="text"
            value={name}
            autoComplete="name"
            placeholder="Your name"
            onChange={setName}
          />
        ) : null}

        <Field
          id="auth-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          onChange={setEmail}
        />

        <Field
          id="auth-password"
          label="Password"
          type="password"
          value={password}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          placeholder={isSignUp ? "At least 8 characters" : "Your password"}
          onChange={setPassword}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm leading-relaxed text-red-700"
        >
          {error}
        </p>
      ) : null}

      <CapsuleButton
        type="submit"
        size="lg"
        disabled={busy}
        className="mt-5 w-full"
      >
        {busy ? "Please wait" : isSignUp ? "Create account" : "Sign in"}
      </CapsuleButton>

      <p className="mt-3 text-center text-xs leading-relaxed text-foreground-muted">
        {isSignUp
          ? "Already have an account? Switch to Sign in above."
          : "New here? Switch to Create account above."}
      </p>
    </form>
  );
}

function ModePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`capsule-button flex-1 px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-primary text-white shadow-sm"
          : "border border-border/60 bg-white text-foreground-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  type: "text" | "email" | "password";
  value: string;
  placeholder: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground/80">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-input/70 bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-input/80 focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
