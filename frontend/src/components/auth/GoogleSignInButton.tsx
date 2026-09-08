"use client";

import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";
import { fetchGoogleClientId, loadGoogleIdentityServices } from "@/lib/google";
import { useTheme } from "@/lib/theme";

interface Props {
  /** Wording inside Google's button — Zoom says "Sign in with Google". */
  text?: "signin_with" | "signup_with" | "continue_with";
  onSignedIn: () => void;
  onError: (message: string) => void;
}

/**
 * Google's own rendered button. It is the only supported way to start the flow:
 * Google hands back a signed ID token, which the backend verifies before it
 * trusts a single claim in it.
 *
 * Renders nothing at all when the backend has no `GOOGLE_CLIENT_ID`, so a
 * deployment without Google configured shows a plain e-mail form.
 */
export function GoogleSignInButton({ text = "signin_with", onSignedIn, onError }: Props) {
  const { signInWithGoogle } = useAuth();
  const { theme } = useTheme();
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);

  // Callbacks are read through a ref so re-rendering the page (typing in the
  // form above) never re-initialises Google's iframe. Kept in an effect that
  // runs before the mount effect below, so the ref is current when it fires.
  const handlers = useRef({ onSignedIn, onError, signInWithGoogle });
  useEffect(() => {
    handlers.current = { onSignedIn, onError, signInWithGoogle };
  });

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      const clientId = await fetchGoogleClientId();
      if (cancelled) return;
      if (!clientId) {
        setState("unavailable");
        return;
      }

      let google;
      try {
        google = await loadGoogleIdentityServices();
      } catch {
        if (!cancelled) setState("unavailable");
        return;
      }
      if (cancelled || !holder.current) return;

      google.accounts.id.initialize({
        client_id: clientId,
        cancel_on_tap_outside: true,
        callback: async ({ credential }) => {
          if (!credential) {
            handlers.current.onError("Google did not return a sign-in token. Try again.");
            return;
          }
          setBusy(true);
          try {
            await handlers.current.signInWithGoogle(credential);
            handlers.current.onSignedIn();
          } catch (caught) {
            handlers.current.onError(
              caught instanceof Error ? caught.message : "Google sign-in failed",
            );
          } finally {
            setBusy(false);
          }
        },
      });

      holder.current.replaceChildren();
      google.accounts.id.renderButton(holder.current, {
        theme: theme === "dark" ? "filled_black" : "outline",
        size: "large",
        shape: "rectangular",
        text,
        logo_alignment: "center",
        // Google needs a pixel width; match the form above it.
        width: Math.min(Math.round(holder.current.offsetWidth) || 360, 400),
      });
      setState("ready");
    }

    void mount();
    return () => {
      cancelled = true;
    };
  }, [theme, text]);

  if (state === "unavailable") return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="relative mt-4 flex min-h-[44px] justify-center">
        <div ref={holder} className="w-full [color-scheme:light]" />
        {(state === "loading" || busy) && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-surface-2/70">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}
