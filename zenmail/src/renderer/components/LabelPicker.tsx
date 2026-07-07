import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import { SNOOZE_LABEL_NAME } from '../../shared/types';

export function LabelPicker() {
  const open = useMailStore((s) => s.labelPickerOpen);
  const close = useMailStore((s) => s.closeLabelPicker);
  const labels = useMailStore((s) => s.labels);
  const applyLabel = useMailStore((s) => s.applyLabel);
  const setActiveLabel = useMailStore((s) => s.setActiveLabel);
  const bulkSelectedIds = useMailStore((s) => s.bulkSelectedIds);
  const applyLabelSelected = useMailStore((s) => s.applyLabelSelected);

  const [filter, setFilter] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFilter('');
      setHighlighted(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const candidates = labels.filter(
    (l) =>
      l.type === 'user' &&
      l.name !== SNOOZE_LABEL_NAME &&
      l.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 pt-32"
      onClick={close}
    >
      <div
        className="zen-fade-in w-80 overflow-hidden rounded-lg border border-bg-border bg-bg-subtle shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, candidates.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            }
            if (e.key === 'Enter' && candidates[highlighted]) {
              if (e.shiftKey) {
                setActiveLabel(candidates[highlighted].id);
                close();
              } else {
                const id = candidates[highlighted].id;
                void (bulkSelectedIds.size > 0 ? applyLabelSelected(id) : applyLabel(id));
              }
            }
          }}
          placeholder="Apply label… (⇧↩ to jump to label)"
          className="w-full border-b border-bg-border bg-transparent px-3 py-2.5 text-[13px] outline-none placeholder:text-text-muted"
        />
        <ul className="max-h-64 overflow-y-auto p-1">
          {candidates.map((l, i) => (
            <li key={l.id}>
              <button
                onClick={() => void (bulkSelectedIds.size > 0 ? applyLabelSelected(l.id) : applyLabel(l.id))}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
                  i === highlighted ? 'bg-bg-border' : 'hover:bg-bg-border/50'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: l.color?.backgroundColor ?? 'var(--color-text-muted)' }}
                />
                {l.name}
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="px-2 py-2 text-[12px] text-text-muted">No matching labels</li>
          )}
        </ul>
      </div>
    </div>
  );
}
