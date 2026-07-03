import { useEffect, useRef } from 'react';
import { useKBar, VisualState } from 'kbar';
import { useCoachStore, type CoachToast } from '../store/coach';

/**
 * Detects the palette's first hidden→visible transition and records the
 * "first command palette" milestone (CP4). kbar owns ⌘K entirely — this only
 * observes visualState, it never dispatches or intercepts the keystroke
 * (D8/D11: single owner of the shortcut stays kbar).
 */
function usePaletteMilestone(): void {
  const { visualState } = useKBar((state) => ({ visualState: state.visualState }));
  const wasVisible = useRef(false);

  useEffect(() => {
    const isVisible = visualState === VisualState.animatingIn || visualState === VisualState.showing;
    if (isVisible && !wasVisible.current) {
      useCoachStore.getState().bumpStat('palette');
    }
    wasVisible.current = isVisible;
  }, [visualState]);
}

function CoachToastItem({ toast }: { toast: CoachToast }) {
  const dismissCoachToast = useCoachStore((s) => s.dismissCoachToast);
  const muteHints = useCoachStore((s) => s.muteHints);

  useEffect(() => {
    const t = setTimeout(() => dismissCoachToast(toast.seq), 4000);
    return () => clearTimeout(t);
  }, [toast.seq, dismissCoachToast]);

  if (toast.kind === 'milestone') {
    return (
      <div className="zen-fade-in flex items-center gap-2 rounded-lg border border-bg-border bg-bg-subtle px-4 py-2 text-[13px] text-text-secondary shadow-xl">
        <span className="text-accent">✓</span>
        <span>{toast.message}</span>
      </div>
    );
  }

  return (
    <div className="zen-fade-in flex items-center gap-3 rounded-lg border border-bg-border bg-bg-subtle px-4 py-2 shadow-xl">
      {toast.keys?.length ? (
        <span className="flex gap-1">
          {toast.keys.map((k, i) => (
            <kbd
              key={i}
              className="rounded border border-bg-border bg-bg px-1.5 py-0.5 font-sans text-[10px] text-text-muted"
            >
              {k}
            </kbd>
          ))}
        </span>
      ) : null}
      <span className="text-[13px] text-text-primary">{toast.message}</span>
      <button
        onClick={() => dismissCoachToast(toast.seq)}
        className="text-[12px] font-medium text-accent hover:text-accent-hover"
      >
        Got it
      </button>
      <button
        onClick={() => {
          muteHints();
          dismissCoachToast(toast.seq);
        }}
        className="text-[12px] text-text-muted hover:text-text-secondary"
      >
        Stop tips
      </button>
    </div>
  );
}

/**
 * Independent toast stack for coaching hints (CP3) and milestones (CP4) —
 * never shares a slot with store.toast's single 2.5s action toast (D9).
 * Mounted as a sibling to <Toasts/>, positioned above it so the two stacks
 * never overlap.
 */
export function CoachToastHost() {
  usePaletteMilestone();
  const coachToasts = useCoachStore((s) => s.coachToasts);

  return (
    <div
      aria-live="polite"
      className="pointer-events-auto absolute bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {coachToasts.map((toast) => (
        <CoachToastItem key={toast.seq} toast={toast} />
      ))}
    </div>
  );
}
