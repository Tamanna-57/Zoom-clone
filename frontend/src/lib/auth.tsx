"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, getToken, setToken } from "./api";
import { forgetGoogleSession } from "./google";
import type { AuthResponse, User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signUp: (body: { email: string; display_name: string; password: string; job_title?: string }) => Promise<void>;
  verify: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const adopt = useCallback((response: AuthResponse) => {
    setToken(response.access_token);
    setUser(response.user);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      setUser,
      refresh,
      signIn: async (email, password) => adopt(await api.login({ email, password })),
      signInWithGoogle: async (credential) => adopt(await api.googleLogin(credential)),
      signUp: async (body) => adopt(await api.register(body)),
      verify: async (email, code) => adopt(await api.verify({ email, code })),
      signOut: async () => {
        try {
          await api.logout();
        } catch {
          // A dead session is still a sign-out as far as the user is concerned.
        }
        setToken(null);
        setUser(null);
        // Otherwise Google silently signs the same account straight back in.
        forgetGoogleSession();
        router.push("/login");
      },
    }),
    [user, loading, adopt, refresh, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
