"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Toggle, inputClass } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

export function JoinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [muted, setMuted] = useState(true);
  const [cameraOff, setCameraOff] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\D/g, "");
    if (!clean) return;
    const params = new URLSearchParams({ mic: muted ? "off" : "on", cam: cameraOff ? "off" : "on" });
    router.push(`/meeting/${clean}?${params.toString()}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join meeting"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button form="join-form" type="submit" disabled={!code.replace(/\D/g, "")}>Join</Button>
        </>
      }
    >
      <form id="join-form" onSubmit={submit} className="space-y-4">
        <Field label="Meeting ID" hint="11 digits, spaces are ignored.">
          <input
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${inputClass} text-lg tracking-wider`}
            placeholder="123 4567 8901"
          />
        </Field>
        <div className="rounded-xl border border-line p-2">
          <Toggle checked={muted} onChange={setMuted} label="Don't connect to audio" />
          <Toggle checked={cameraOff} onChange={setCameraOff} label="Turn off my video" />
        </div>
      </form>
    </Modal>
  );
}
