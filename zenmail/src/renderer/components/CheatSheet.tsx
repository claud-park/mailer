import { useEffect, useRef } from 'react';
import { useCoachStore } from '../store/coach';
import { SHORTCUTS, type ShortcutDef } from '../lib/shortcuts';

const SECTIONS: ShortcutDef['section'][] = ['Actions', 'Navigation', 'View', 'Help'];

export function CheatSheet() {
  const open = useCoachStore((s) => s.cheatSheetOpen);
  const close = useCoachStore((s) => s.closeCheatSheet);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="zen-fade-in max-h-[80vh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-lg border border-bg-border bg-bg-subtle p-4 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // keep global single-key shortcuts (kbar) from firing behind the modal
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-text-primary">Keyboard shortcuts</div>
          <button
            onClick={close}
            aria-label="Close keyboard shortcuts"
            className="rounded px-2 py-1 text-text-secondary hover:bg-bg-border hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {SECTIONS.map((section) => {
            const items = SHORTCUTS.filter((item) => item.section === section);
            if (!items.length) return null;
            return (
              <div key={section}>
                <div className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
                  {section}
                </div>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-[13px] text-text-secondary"
                  >
                    <span>{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="rounded border border-bg-border bg-bg px-1.5 py-0.5 font-sans text-[10px] text-text-muted"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
