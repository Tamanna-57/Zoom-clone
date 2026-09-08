"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";
import { MOCK_OTP } from "@/lib/config";
import { useToast } from "@/lib/toast";

/**
 * Two-step onboarding that mirrors Zoom's sign-up: details first, then a
 * verification code. Signing up with Google skips both steps, because Google
 * has already proved the address.
 *
 * E-mail verification is still mocked — the backend accepts one fixed OTP.
 */
export default function RegisterPage() {
  const { signUp, verify } = useAuth();
  const router = useRouter();
  const { notify } = useToast();

  const [step, setStep] = useState<"details" | "verify">("details");
  const [form, setForm] = useState({ display_name: "", email: "", password: "", job_title: "" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signUp({
        email: form.email.trim(),
        display_name: form.display_name.trim(),
        password: form.password,
        job_title: form.job_title.trim() || undefined,
      });
      setStep("verify");
      notify({ kind: "info", title: "Verification code sent", detail: `Simulated code: ${MOCK_OTP}` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await verify(form.email.trim(), code.trim());
      notify({ kind: "success", title: "Account verified", detail: "Welcome to Zoomeet." });
      router.replace("/home");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was rejected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      {step === "details" ? (
        <>
          <h1 className="text-2xl font-bold text-body">Create your account</h1>
          <p className="mt-1 text-sm text-muted">Free to use. No card required.</p>

          <form onSubmit={submitDetails} className="mt-6 space-y-4">
            <Field label="Full name">
              <input required value={form.display_name} onChange={update("display_name")} className={inputClass} placeholder="Ada Lovelace" />
            </Field>
            <Field label="Work email">
              <input required type="email" value={form.email} onChange={update("email")} className={inputClass} placeholder="ada@company.com" />
            </Field>
            <Field label="Job title" hint="Optional — shown on your profile card.">
              <input value={form.job_title} onChange={update("job_title")} className={inputClass} placeholder="Product Engineer" />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <input required type="password" minLength={6} value={form.password} onChange={update("password")} className={inputClass} placeholder="••••••••" />
            </Field>

            {error && (
              <p className="flex items-center gap-2 rounded-lg bg-zoom-red/10 px-3 py-2 text-xs font-medium text-zoom-red">
                <Icon name="info" size={14} /> {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : null} Continue
            </Button>
          </form>

          <GoogleSignInButton
            text="signup_with"
            onSignedIn={() => {
              notify({ kind: "success", title: "Welcome to Zoomeet", detail: "Signed up with Google." });
              router.replace("/home");
            }}
            onError={setError}
          />

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-zoom-blue hover:underline">
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <>
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-zoom-blue-soft text-zoom-blue">
            <Icon name="shield" size={22} />
          </div>
          <h1 className="text-2xl font-bold text-body">Verify it&apos;s you</h1>
          <p className="mt-1 text-sm text-muted">
            We sent a 6-digit code to <span className="font-medium text-body">{form.email}</span>.
          </p>

          <form onSubmit={submitCode} className="mt-6 space-y-4">
            <Field label="Verification code">
              <input
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
                placeholder="000000"
              />
            </Field>

            <p className="rounded-lg bg-zoom-blue-soft px-3 py-2 text-xs text-zoom-blue">
              E-mail verification is not wired to a mail provider yet — the code is always{" "}
              <button type="button" onClick={() => setCode(MOCK_OTP)} className="font-bold underline">
                {MOCK_OTP}
              </button>
              .
            </p>

            {error && (
              <p className="flex items-center gap-2 rounded-lg bg-zoom-red/10 px-3 py-2 text-xs font-medium text-zoom-red">
                <Icon name="info" size={14} /> {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : null} Verify and continue
            </Button>
            <button type="button" onClick={() => setStep("details")} className="w-full text-center text-xs text-muted hover:text-body">
              Use a different email
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
