import { Icon } from "@/components/ui/Icon";

/** The signed-out chrome: Zoom's blue wordmark over a light gradient. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-zoom-blue via-[#1573e6] to-[#0a4fa8] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
            <Icon name="video" size={20} />
          </span>
          Zoomeet
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Meetings that write themselves down.</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            HD video, in-call chat and screen share — plus an AI notetaker that turns every call into a
            summary, action items and a searchable transcript the moment you hang up.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/90">
            {[
              ["video", "Peer-to-peer WebRTC video and screen sharing"],
              ["sparkles", "Automatic recap: TL;DR, decisions, action items"],
              ["list", "Full transcript with speaker talk-time breakdown"],
            ].map(([icon, label]) => (
              <li key={label} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15">
                  <Icon name={icon as "video"} size={16} />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/60">
          Calls are peer-to-peer over WebRTC. Recaps are generated on your own server.
        </p>
      </div>

      <div className="flex items-center justify-center bg-surface-2 px-5 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
