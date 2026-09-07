"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { Contact, User } from "@/lib/types";

/** Someone is "online" if the API saw them in the last two minutes. */
function isOnline(user: User): boolean {
  return Date.now() - new Date(user.last_seen_at).getTime() < 120_000;
}

export default function ContactsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { notify } = useToast();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [directory, setDirectory] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    try {
      const [saved, all] = await Promise.all([api.contacts(), api.searchUsers()]);
      setContacts(saved);
      setDirectory(all);
    } catch {
      notify({ kind: "error", title: "Could not load contacts" });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter(
      (entry) =>
        entry.contact.display_name.toLowerCase().includes(needle) ||
        entry.contact.email.toLowerCase().includes(needle),
    );
  }, [contacts, query]);

  const starred = filtered.filter((entry) => entry.starred);
  const others = filtered.filter((entry) => !entry.starred);

  const notYetSaved = useMemo(() => {
    const saved = new Set(contacts.map((entry) => entry.contact.id));
    return directory.filter((person) => !saved.has(person.id));
  }, [contacts, directory]);

  async function addContact(email: string) {
    setAddError("");
    try {
      await api.addContact(email.trim());
      notify({ kind: "success", title: "Contact added" });
      setShowAdd(false);
      setNewEmail("");
      void load();
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : "Could not add that contact");
    }
  }

  async function meetNow(person: User) {
    const meeting = await api.createMeeting({
      topic: `${user?.display_name} & ${person.display_name}`,
      start_now: true,
      passcode_required: false,
      mute_on_entry: false,
      invitee_ids: [person.id],
    });
    router.push(`/meeting/${meeting.code}`);
  }

  const row = (entry: Contact) => (
    <button
      key={entry.id}
      onClick={() => setSelected(entry)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-zoom-blue/40"
    >
      <Avatar name={entry.contact.display_name} color={entry.contact.avatar_color} online={isOnline(entry.contact)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-body">{entry.contact.display_name}</span>
          {entry.starred && <Icon name="star" size={13} className="text-zoom-orange" />}
        </span>
        <span className="block truncate text-xs text-muted">{entry.contact.job_title ?? entry.contact.email}</span>
      </span>
      <span className="text-[11px] text-muted">{isOnline(entry.contact) ? "Available" : "Offline"}</span>
    </button>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-body">Contacts</h1>
        <Button onClick={() => setShowAdd(true)}>
          <Icon name="user-plus" size={16} /> Add contact
        </Button>
      </div>

      <div className="relative mt-4">
        <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts"
          className={`${inputClass} pl-9`}
        />
      </div>

      {loading ? (
        <div className="mt-10 grid place-items-center text-muted"><Spinner /></div>
      ) : (
        <div className="mt-5 space-y-6">
          {starred.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Starred</h2>
              <div className="space-y-2">{starred.map(row)}</div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              All contacts · {others.length}
            </h2>
            <div className="space-y-2">{others.map(row)}</div>
            {filtered.length === 0 && <EmptyState title="No contacts match" detail="Try a different name or email." />}
          </section>

          {notYetSaved.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">People on Zoomeet</h2>
              <div className="space-y-2">
                {notYetSaved.map((person) => (
                  <div key={person.id} className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3">
                    <Avatar name={person.display_name} color={person.avatar_color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-body">{person.display_name}</span>
                      <span className="block truncate text-xs text-muted">{person.email}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => void addContact(person.email)}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add a contact" subtitle="They must already have a Zoomeet account.">
        <Field label="Email address">
          <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} className={inputClass} placeholder="colleague@company.com" />
        </Field>
        {addError && <p className="mt-3 rounded-lg bg-zoom-red/10 px-3 py-2 text-xs font-medium text-zoom-red">{addError}</p>}
        <Button className="mt-4 w-full" onClick={() => void addContact(newEmail)} disabled={!newEmail.trim()}>
          Add contact
        </Button>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.contact.display_name ?? ""}>
        {selected && (
          <div className="text-center">
            <Avatar name={selected.contact.display_name} color={selected.contact.avatar_color} size="xl" className="mx-auto" />
            <p className="mt-3 text-lg font-semibold text-body">{selected.contact.display_name}</p>
            <p className="text-sm text-muted">{selected.contact.job_title ?? "Zoomeet user"}</p>
            <p className="mt-1 text-xs text-muted">{selected.contact.email}</p>
            <p className="mt-1 text-xs text-muted">
              {isOnline(selected.contact) ? "Available now" : `Last seen ${new Date(selected.contact.last_seen_at).toLocaleString()}`}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <Button onClick={() => void meetNow(selected.contact)}>
                <Icon name="video" size={15} /> Meet
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api.starContact(selected.id);
                  setSelected(null);
                  void load();
                }}
              >
                <Icon name="star" size={15} /> {selected.starred ? "Unstar" : "Star"}
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api.removeContact(selected.id);
                  setSelected(null);
                  void load();
                }}
              >
                <Icon name="trash" size={15} /> Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
