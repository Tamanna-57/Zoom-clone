"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { RecapView } from "@/components/recap/RecapView";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { ActionItem, RecordingDetail } from "@/lib/types";

export default function RecordingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { notify } = useToast();

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecording(await api.recording(Number(id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording not found");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleItem(item: ActionItem) {
    const next = item.status === "done" ? "open" : "done";
    setRecording((current) =>
      current
        ? { ...current, action_items: current.action_items.map((row) => (row.id === item.id ? { ...row, status: next } : row)) }
        : current,
    );
    await api.updateActionItem(item.id, { status: next }).catch(() => void load());
  }

  async function addItem(text: string) {
    if (!recording) return;
    const created = await api.addActionItem(recording.id, { text });
    setRecording({ ...recording, action_items: [...recording.action_items, created] });
  }

  async function deleteItem(item: ActionItem) {
    if (!recording) return;
    setRecording({ ...recording, action_items: recording.action_items.filter((row) => row.id !== item.id) });
    await api.deleteActionItem(item.id).catch(() => void load());
  }

  async function regenerate() {
    if (!recording) return;
    setRegenerating(true);
    try {
      setRecording(await api.regenerateSummary(recording.id));
      notify({ kind: "success", title: "Recap regenerated" });
    } catch {
      notify({ kind: "error", title: "Could not regenerate the recap" });
    } finally {
      setRegenerating(false);
    }
  }

  async function share() {
    if (!recording) return;
    await navigator.clipboard.writeText(`${window.location.origin}/shared/${recording.share_token}`);
    notify({ kind: "success", title: "Share link copied", detail: "Anyone with the link can read this recap." });
  }

  if (error) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <p className="text-sm font-semibold text-body">{error}</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push("/recordings")}>
          Back to AI Notes
        </Button>
      </div>
    );
  }

  if (!recording) return <FullPageSpinner label="Loading the recap" />;

  return (
    <>
      <button onClick={() => router.push("/recordings")} className="mb-4 flex items-center gap-2 text-sm text-muted transition hover:text-body">
        <Icon name="arrow-left" size={16} /> All AI notes
      </button>
      <RecapView
        recording={recording}
        onToggleItem={toggleItem}
        onAddItem={addItem}
        onDeleteItem={deleteItem}
        onRegenerate={regenerate}
        onShare={share}
        regenerating={regenerating}
      />
    </>
  );
}
