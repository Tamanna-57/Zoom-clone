"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";

const DEMO_ACCOUNTS = [
  { email: "priya@zoomeet.dev", name: "Priya Nair", role: "VP Product · hosts most meetings" },
  { email: "arjun@zoomeet.dev", name: "Arjun Mehta", role: "Staff Engineer" },
  { email: "dev@zoomeet.dev", name: "Dev Sharma", role: "Design Lead" },
];

export default function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();
  const { notify } = useToast();

  const [email, setEmail] = useState("priya@zoomeet.dev");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email.trim(), password);
      notify({ kind: "success", title: "Signed in", detail: "Welcome back to Zoomeet." });
      router.replace("/home");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-zoom-blue text-white">
          <Icon name="video" size={18} />
        </span>
        <span className="text-lg font-bold text-body">Zoomeet</span>
      </div>

      <h1 className="text-2xl font-bold text-body">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use a seeded demo account or your own.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-zoom-red/10 px-3 py-2 text-xs font-medium text-zoom-red">
            <Icon name="info" size={14} /> {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Sign in
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-semibold text-zoom-blue hover:underline">
          Create an account
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-line bg-surface p-3">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Seeded accounts · password123
        </p>
        <div className="space-y-1">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword("password123");
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition hover:bg-surface-2"
            >
              <span>
                <span className="block text-sm font-medium text-body">{account.name}</span>
                <span className="block text-[11px] text-muted">{account.role}</span>
              </span>
              <span className="text-[11px] text-zoom-blue">use</span>
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
