import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import { newSnippet } from '../lib/snippets';
import type { SnippetRecord } from '../../shared/types';

export function SnippetsManager() {
  const open = useMailStore((s) => s.snippetsOpen);
  const close = useMailStore((s) => s.closeSnippets);
  const snippets = useMailStore((s) => s.snippets);
  const saveSnippets = useMailStore((s) => s.saveSnippets);

  const [draft, setDraft] = useState<SnippetRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(snippets.map((s) => ({ ...s })));
      setEditingId(null);
      setNewName('');
      setNewBody('');
      panelRef.current?.focus();
    }
  }, [open, snippets]);

  if (!open) return null;

  function update(id: string, patch: Partial<SnippetRecord>) {
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function remove(id: string) {
    setDraft((ds) => ds.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addSnippet() {
    const name = newName.trim();
    if (!name) return;
    setDraft((ds) => [...ds, newSnippet(name, newBody, Date.now())]);
    setNewName('');
    setNewBody('');
  }

  function save() {
    void saveSnippets(draft);
    close();
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="zen-fade-in flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-lg border border-bg-border bg-bg-subtle shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="border-b border-bg-border px-4 py-3 text-[13px] font-semibold text-text-primary">
          Snippets
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {draft.map((d) =>
              editingId === d.id ? (
                <div key={d.id} className="flex flex-col gap-2 rounded-md border border-bg-border p-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => update(d.id, { name: e.target.value })}
                      aria-label="Snippet name"
                      spellCheck={false}
                      className="w-32 flex-none rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
                    />
                    <div className="ml-auto flex flex-none items-center gap-1">
                      <button
                        onClick={() => setEditingId(null)}
                        title="Done editing"
                        aria-label={`Done editing ${d.name}`}
                        className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border"
                      >
                        Done
                      </button>
                      <button
                        onClick={() => remove(d.id)}
                        title="Delete snippet"
                        aria-label={`Delete ${d.name}`}
                        className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={d.body}
                    onChange={(e) => update(d.id, { body: e.target.value })}
                    aria-label="Snippet body"
                    rows={3}
                    spellCheck={false}
                    className="w-full resize-none rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
                  />
                </div>
              ) : (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-md border border-bg-border p-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12px] font-medium text-text-primary">{d.name}</span>
                    <span className="truncate text-[11px] text-text-muted">{d.body}</span>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <button
                      onClick={() => setEditingId(d.id)}
                      title="Edit snippet"
                      aria-label={`Edit ${d.name}`}
                      className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(d.id)}
                      title="Delete snippet"
                      aria-label={`Delete ${d.name}`}
                      className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            )}

            <div className="flex flex-col gap-2 rounded-md border border-dashed border-bg-border p-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Snippet name"
                aria-label="New snippet name"
                spellCheck={false}
                className="w-full rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted"
              />
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Snippet body"
                aria-label="New snippet body"
                rows={3}
                spellCheck={false}
                className="w-full resize-none rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted"
              />
              <button
                onClick={addSnippet}
                disabled={!newName.trim()}
                className="self-start rounded-md border border-bg-border px-2 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-border/50 disabled:opacity-30"
              >
                + Add snippet
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-bg-border px-4 py-3">
          <button onClick={close} className="rounded-md px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-border">
            Cancel
          </button>
          <button onClick={save} className="rounded-md bg-accent px-3 py-1.5 text-[12px] text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
