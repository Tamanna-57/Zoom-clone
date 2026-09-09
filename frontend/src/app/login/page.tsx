"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { useToast } from "@/lib/toast";

export default function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();
  const { notify } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [misconfigured, setMisconfigured] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  // A hosted build that still points at localhost cannot work: the browser
  // blocks a plain-HTTP call from an HTTPS page. Say so before they try.
  useEffect(() => {
    setMisconfigured(
      window.location.protocol === "https:" && /localhost|127\.0\.0\.1/.test(API_URL),
    );
  }, []);

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
      <p className="mt-1 text-sm text-muted">Welcome back. Sign in to start or join a meeting.</p>

      {misconfigured && (
        <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-700">
          <p className="font-semibold">This deployment has no backend configured.</p>
          <p className="mt-1">
            It is calling <span className="font-mono">{API_URL}</span>, which a hosted page cannot reach.
            Set <span className="font-mono">NEXT_PUBLIC_API_URL</span> to your deployed API and redeploy.
          </p>
        </div>
      )}

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

      <GoogleSignInButton
        text="signin_with"
        onSignedIn={() => {
          notify({ kind: "success", title: "Signed in", detail: "Welcome back to Zoomeet." });
          router.replace("/home");
        }}
        onError={setError}
      />

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-semibold text-zoom-blue hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
