"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4" aria-label="Sign in">
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-nx-muted">
        Username
        <input
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          className="h-7 border border-nx-border bg-nx-inset px-2 text-[12px] normal-case tracking-normal text-nx-text-bright focus:border-nx-amber focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-nx-muted">
        Password
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="h-7 border border-nx-border bg-nx-inset px-2 text-[12px] normal-case tracking-normal text-nx-text-bright focus:border-nx-amber focus:outline-none"
        />
      </label>
      {error && (
        <div role="alert" className="border border-nx-down/40 bg-nx-down/10 px-2 py-1 text-[11px] text-nx-down">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-1 h-8 border border-nx-amber/60 bg-nx-amber/10 text-[12px] font-semibold tracking-wider text-nx-amber hover:bg-nx-amber/20 disabled:opacity-40"
      >
        {busy ? "…" : "SIGN IN"}
      </button>
    </form>
  );
}
