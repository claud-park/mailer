import { useEffect, useRef, useState } from 'react';
import type { SnippetRecord } from '../../shared/types';
import { filterSnippets } from '../lib/snippets';

export function SnippetPicker({
  snippets,
  onInsert,
  onClose,
}: {
  snippets: SnippetRecord[];
  onInsert: (body: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = filterSnippets(snippets, query);

  useEffect(() => {
    // keep the highlight within bounds as the filtered list shrinks/grows
    setHighlighted((h) => Math.min(h, Math.max(results.length - 1, 0)));
  }, [results.length]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="zen-fade-in w-80 rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // consume Esc here (before Compose's Escape handler) — close the picker, keep Compose
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const s = results[highlighted];
            if (s) onInsert(s.body);
          }
          e.stopPropagation();
        }}
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Insert snippet…
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search snippets"
          className="mb-1 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary outline-none"
        />
        {snippets.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-text-muted">
            No snippets yet — ⌘K → Snippets…
          </div>
        ) : results.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-text-muted">No matches</div>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {results.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => onInsert(s.body)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left ${
                    i === highlighted ? 'bg-bg-border' : ''
                  }`}
                >
                  <span className="text-[13px] text-text-primary">{s.name}</span>
                  <span className="w-full truncate text-[11px] text-text-muted">
                    {s.body.split('\n')[0]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
