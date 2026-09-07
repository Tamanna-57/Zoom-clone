"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { RecapView } from "@/components/recap/RecapView";
import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { RecordingDetail } from "@/lib/types";

/** Public, read-only recap. No sign-in: the share token is the credential. */
export default function SharedRecapPage() {
  const { token } = useParams<{ token: string }>();
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .sharedRecording(token)
      .then(setRecording)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "This link is not valid"));
  }, [token]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-2 px-4 text-center">
        <div>
          <p className="text-sm font-semibold text-body">{error}</p>
          <ButtonLink href="/login" variant="secondary" className="mt-4">Go to Zoomeet</ButtonLink>
        </div>
      </div>
    );
  }

  if (!recording) return <FullPageSpinner label="Opening shared recap" />;

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-body">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-zoom-blue text-white">
              <Icon name="video" size={16} />
            </span>
            Zoomeet
          </span>
          <span className="text-xs text-muted">Shared meeting recap · read only</span>
        </div>
      </header>
      <div className="px-4 py-6">
        <RecapView recording={recording} readOnly />
      </div>
    </div>
  );
}
