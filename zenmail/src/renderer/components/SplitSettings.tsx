import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import type { SplitDefinition, SplitRule } from '../../shared/types';

function emptyRuleFor(kind: SplitRule['kind']): SplitRule {
  if (kind === 'senders') return { kind: 'senders', emails: [] };
  if (kind === 'domains') return { kind: 'domains', domains: [] };
  if (kind === 'labels') return { kind: 'labels', labelIds: [] };
  return { kind: 'newsletter' };
}

const RULE_KINDS: SplitRule['kind'][] = ['senders', 'domains', 'labels', 'newsletter'];

/** simple chip-list input for senders/domains — Enter or comma commits a chip, lowercased */
function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  function commit(raw: string) {
    const v = raw.trim().toLowerCase();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
  }

  return (
    <div className="flex flex-1 flex-wrap items-center gap-1 rounded border border-bg-border bg-bg px-2 py-1">
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1 rounded bg-bg-border px-1.5 py-0.5 text-[11px] text-text-primary"
        >
          {v}
          <button
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            const parts = v.split(',');
            const remainder = parts.pop() ?? '';
            parts.forEach(commit);
            setInput(remainder);
          } else {
            setInput(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(input);
            setInput('');
          } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          commit(input);
          setInput('');
        }}
        placeholder={values.length === 0 ? placeholder : ''}
        className="min-w-[80px] flex-1 bg-transparent py-0.5 text-[12px] text-text-primary outline-none placeholder:text-text-muted"
      />
    </div>
  );
}

function LabelMultiSelect({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const labels = useMailStore((s) => s.labels);
  return (
    <div className="flex max-h-24 flex-1 flex-col gap-0.5 overflow-y-auto rounded border border-bg-border bg-bg px-2 py-1">
      {labels.map((l) => (
        <label key={l.id} className="flex items-center gap-1.5 text-[12px] text-text-primary">
          <input
            type="checkbox"
            checked={selected.includes(l.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, l.id] : selected.filter((id) => id !== l.id))
            }
          />
          {l.name}
        </label>
      ))}
      {labels.length === 0 && <span className="text-[11px] text-text-muted">No labels</span>}
    </div>
  );
}

function RuleEditor({ rule, onChange }: { rule: SplitRule; onChange: (r: SplitRule) => void }) {
  if (rule.kind === 'senders') {
    return (
      <ChipInput
        values={rule.emails}
        onChange={(emails) => onChange({ kind: 'senders', emails })}
        placeholder="sender@example.com, …"
      />
    );
  }
  if (rule.kind === 'domains') {
    return (
      <ChipInput
        values={rule.domains}
        onChange={(domains) => onChange({ kind: 'domains', domains })}
        placeholder="example.com, …"
      />
    );
  }
  if (rule.kind === 'labels') {
    return <LabelMultiSelect selected={rule.labelIds} onChange={(labelIds) => onChange({ kind: 'labels', labelIds })} />;
  }
  return <div className="flex-1 text-[12px] text-text-muted">Automatic — category label or newsletter sender pattern</div>;
}

export function SplitSettings() {
  const open = useMailStore((s) => s.splitSettingsOpen);
  const close = useMailStore((s) => s.closeSplitSettings);
  const splitDefs = useMailStore((s) => s.splitDefs);
  const saveSplits = useMailStore((s) => s.saveSplits);

  const [draft, setDraft] = useState<SplitDefinition[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(
        splitDefs
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((d) => ({ ...d }))
      );
      panelRef.current?.focus();
    }
  }, [open, splitDefs]);

  if (!open) return null;

  function update(id: string, patch: Partial<SplitDefinition>) {
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function move(id: string, dir: -1 | 1) {
    setDraft((ds) => {
      const sorted = ds.slice().sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex((d) => d.id === id);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return ds;
      const a = sorted[idx];
      const b = sorted[swapIdx];
      const aPos = a.position;
      a.position = b.position;
      b.position = aPos;
      return sorted.map((d) => ({ ...d }));
    });
  }

  function remove(id: string) {
    setDraft((ds) => ds.filter((d) => d.id !== id));
  }

  function addSplit() {
    setDraft((ds) => [
      ...ds,
      {
        id: crypto.randomUUID(),
        name: 'New split',
        position: ds.length,
        enabled: true,
        rule: { kind: 'senders', emails: [] },
      },
    ]);
  }

  function save() {
    void saveSplits(draft);
    close();
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="zen-fade-in flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-lg border border-bg-border bg-bg-subtle shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="border-b border-bg-border px-4 py-3 text-[13px] font-semibold text-text-primary">
          Configure splits
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {draft
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((d, i, arr) => (
                <div
                  key={d.id}
                  className="flex flex-col gap-2 rounded-md border border-bg-border p-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => update(d.id, { name: e.target.value })}
                      className="w-32 flex-none rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
                    />
                    <select
                      value={d.rule.kind}
                      onChange={(e) => update(d.id, { rule: emptyRuleFor(e.target.value as SplitRule['kind']) })}
                      className="flex-none rounded border border-bg-border bg-bg px-1.5 py-1 text-[12px] text-text-primary"
                    >
                      {RULE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <label className="flex flex-none items-center gap-1 text-[11px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) => update(d.id, { enabled: e.target.checked })}
                      />
                      enabled
                    </label>
                    <div className="ml-auto flex flex-none items-center gap-1">
                      <button
                        onClick={() => move(d.id, -1)}
                        disabled={i === 0}
                        title="Move up"
                        className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(d.id, 1)}
                        disabled={i === arr.length - 1}
                        title="Move down"
                        className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => remove(d.id)}
                        title="Delete split"
                        className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <RuleEditor rule={d.rule} onChange={(rule) => update(d.id, { rule })} />
                  </div>
                </div>
              ))}

            <button
              onClick={addSplit}
              className="rounded-md border border-dashed border-bg-border px-2 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-border/50"
            >
              + Add split
            </button>

            <div className="text-[11px] text-text-muted">Unmatched mail goes to Other.</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-bg-border px-4 py-3">
          <button
            onClick={close}
            className="rounded-md px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-border"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
