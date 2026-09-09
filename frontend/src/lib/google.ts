"use client";

/**
 * Google Identity Services glue.
 *
 * The client id is fetched from the backend's `/api/config` rather than baked in
 * at build time, so rotating the Google credentials does not need a frontend
 * redeploy — and a deployment with no id configured simply hides the button.
 */
import { api } from "./api";

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-identity-services";

export interface GoogleButtonOptions {
  theme: "outline" | "filled_blue" | "filled_black";
  size: "large";
  shape: "rectangular" | "pill";
  text: "signin_with" | "signup_with" | "continue_with";
  logo_alignment: "left" | "center";
  width: number;
}

/** The slice of `window.google.accounts.id` this app uses. */
interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }) => void;
      renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let scriptPromise: Promise<GoogleIdentityServices> | null = null;

/** Inject the GIS script once per page load and resolve when it is usable. */
export function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  if (scriptPromise) return scriptPromise;

  const pending = new Promise<GoogleIdentityServices>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google);
      return;
    }

    const fail = () =>
      reject(new Error("Could not load Google Sign-In. Check your connection and try again."));
    const settle = () => (window.google ? resolve(window.google) : fail());

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", settle, { once: true });
    script.addEventListener("error", fail, { once: true });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    // Let a later mount retry rather than caching the failure forever.
    scriptPromise = null;
    throw error;
  });

  scriptPromise = pending;
  return pending;
}

let clientIdPromise: Promise<string | null> | null = null;

/** The configured Google client id, or null when the server has none. */
export function fetchGoogleClientId(): Promise<string | null> {
  clientIdPromise ??= api
    .clientConfig()
    .then((config) => config.googleClientId ?? null)
    .catch(() => null);
  return clientIdPromise;
}

/** Forget the cached One Tap session so the next sign-in asks again. */
export function forgetGoogleSession() {
  window.google?.accounts.id.disableAutoSelect();
}
