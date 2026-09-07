"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/meetings", label: "Meetings", icon: "calendar" },
  { href: "/recordings", label: "AI Notes", icon: "sparkles" },
  { href: "/contacts", label: "Contacts", icon: "people" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Zoom's desktop client focuses search on Ctrl/Cmd+K.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900 text-white">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
          <Link href="/home" className="flex items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-zoom-blue">
              <Icon name="video" size={17} />
            </span>
            <span className="hidden sm:block">Zoomeet</span>
          </Link>

          <nav className="ml-2 flex items-center gap-1">
            {TABS.map((tab) => {
              const active = pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-white/12 text-white" : "text-ink-300 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <Icon name={tab.icon} size={17} />
                  <span className="hidden md:block">{tab.label}</span>
                </Link>
              );
            })}
          </nav>

          <form
            className="relative ml-auto hidden max-w-xs flex-1 items-center lg:flex"
            onSubmit={(event) => {
              event.preventDefault();
              router.push(`/recordings?q=${encodeURIComponent(query)}`);
            }}
          >
            <Icon name="search" size={16} className="absolute left-3 text-ink-300" />
            <input
              id="global-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search meetings and transcripts"
              className="w-full rounded-lg border border-white/10 bg-white/8 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-ink-300 focus:border-zoom-blue"
            />
          </form>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="ml-auto rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white lg:ml-0"
            aria-label="Toggle colour theme"
            title="Toggle theme"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </button>

          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((open) => !open)} className="flex items-center gap-2 rounded-full p-0.5 transition hover:bg-white/10">
              <Avatar name={user?.display_name ?? "?"} color={user?.avatar_color} size="sm" online />
            </button>

            {menuOpen && (
              <div className="animate-slide-in absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-line bg-surface text-body shadow-2xl">
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <Avatar name={user?.display_name ?? "?"} color={user?.avatar_color} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user?.display_name}</p>
                    <p className="truncate text-xs text-muted">{user?.job_title ?? user?.email}</p>
                  </div>
                </div>
                <div className="p-1.5">
                  <Link href="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-surface-2">
                    <Icon name="settings" size={16} /> Settings
                  </Link>
                  <button
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zoom-red transition hover:bg-zoom-red/10"
                  >
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
