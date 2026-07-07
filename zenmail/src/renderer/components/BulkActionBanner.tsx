import { useMailStore } from '../store/mail';

/**
 * Slim status bar shown above the thread list while a bulk selection (⌘A) is
 * active — mirrors the tone of Toasts/CoachToastHost but sits inline instead
 * of floating, since it needs to stay visible for the whole selection.
 */
export function BulkActionBanner() {
  const count = useMailStore((s) => s.bulkSelectedIds.size);

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-bg-border bg-bg-subtle px-4 py-1.5 text-[12px] text-text-secondary">
      <span className="font-medium text-text-primary">{count} selected</span>
      <span className="text-text-muted">—</span>
      <span>
        <kbd className="rounded border border-bg-border bg-bg px-1 py-0.5 font-sans text-[10px] text-text-muted">
          E
        </kbd>{' '}
        archive
      </span>
      <span>
        <kbd className="rounded border border-bg-border bg-bg px-1 py-0.5 font-sans text-[10px] text-text-muted">
          #
        </kbd>{' '}
        trash
      </span>
      <span>
        <kbd className="rounded border border-bg-border bg-bg px-1 py-0.5 font-sans text-[10px] text-text-muted">
          Esc
        </kbd>{' '}
        cancel
      </span>
    </div>
  );
}
