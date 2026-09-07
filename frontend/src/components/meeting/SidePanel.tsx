"use client";

import { Icon } from "@/components/ui/Icon";

/** The dark right-hand drawer shared by chat, participants and AI notes. */
export function SidePanel({
  title,
  onClose,
  children,
  footer,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <aside className="flex h-full w-full flex-col border-l border-white/8 bg-ink-850 md:w-[340px]">
      <header className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <div className="flex items-center gap-1">
          {actions}
          <button onClick={onClose} aria-label="Close panel" className="rounded-md p-1.5 text-ink-300 transition hover:bg-white/10 hover:text-white">
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-white/8 p-3">{footer}</div>}
    </aside>
  );
}
