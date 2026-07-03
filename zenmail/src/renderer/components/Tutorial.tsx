import { useEffect } from 'react';
import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';
import { TUTORIAL_STEPS } from '../lib/tutorial';

const DISCARD_STEP_INDEX = TUTORIAL_STEPS.findIndex((s) => s.id === 'discard');

/** Same input/textarea/contenteditable check as useKeyboard.ts's isTyping — duplicated
 *  locally rather than imported so this component stays a pure add-on with zero edits
 *  to useKeyboard.ts (see build brief "금지" list). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Auto-starts the CP5 tutorial once, the first time a real (demo) inbox is loaded
 * for a signed-in account and the user hasn't seen it yet (PRD §3-1, D7). Guarded
 * by tutorialActive so React 18 StrictMode's double-invoke of effects is a no-op.
 */
function useTutorialAutoStart(): void {
  const hasAccount = useMailStore((s) => !!s.account);
  const hasThreads = useMailStore((s) => s.threads.length > 0);
  const tutorialSeen = useCoachStore((s) => s.tutorialSeen);
  const tutorialActive = useCoachStore((s) => s.tutorialActive);
  const startTutorial = useCoachStore((s) => s.startTutorial);

  useEffect(() => {
    if (hasAccount && hasThreads && !tutorialSeen && !tutorialActive) {
      startTutorial();
    }
    // startTutorial (a zustand action) is referentially stable — omitted from deps
    // deliberately, matching CommandPalette.tsx's same assumption.
  }, [hasAccount, hasThreads, tutorialSeen, tutorialActive]);
}

/**
 * CP5 interactive tutorial. Renders a coach bubble over the real (demo) inbox and
 * mediates keydown at the window **capture** phase so it runs before useKeyboard's
 * bubble listener and kbar's bubble `tinykeys` listener (confirmed bubble-phase —
 * node_modules/kbar/lib/InternalEvents.js:233 registers via tinykeys.js:152's plain
 * `target.addEventListener(event, onKeyEvent)`, no capture flag). See DECISIONS D7.
 *
 * Mediation rules (in priority order — see PRD §3-1 / DECISIONS D7):
 *  1. isTyping(target) → never interfere (typing 'e' in a compose field must not be
 *     eaten; kbar already refuses shortcuts while typing via shouldRejectKeystrokes).
 *  2. meta/ctrl/alt combos (⌘K, ⌘⇧I, ⌘Enter, ⌘1-9, …) → never interfere.
 *  3. Destructive keys (e / #) → always swallowed tutorial-wide via
 *     preventDefault+stopImmediatePropagation, so no archive/trash can ever fire
 *     during the tour, even on steps that don't expect them. On the archive step
 *     itself, swallowing also counts as progress.
 *  4. Escape:
 *     - If the *current* step's key is Escape (step 4 "close thread", step 7
 *       "discard compose"), it is the designated progression key — left untouched
 *       so the real effect happens (closeThread / Compose's own Escape handler),
 *       and the tutorial advances.
 *     - Otherwise Escape is the "skip tour" gesture: swallowed (so it can't fall
 *       through to useKeyboard's closeThread/clearSearch or Compose's close
 *       handler as an unwanted side effect) and the tutorial exits.
 *  5. Any other key matching the current step's `keys` → left untouched (real
 *     effect happens) and the tutorial advances. Unrelated keys pass through inert.
 *
 * Step 7 exception: Compose auto-focuses the To field, so Escape there almost
 * always fires while isTyping is true — rule 1 means this handler never even sees
 * it. Compose.tsx's own Escape handler calls `e.stopPropagation()` (its wrapping
 * div's onKeyDown), which is a *React* stopPropagation — it stops the underlying
 * native event from bubbling any further, but only after our window **capture**
 * listener has already run (capture precedes bubble), so detection can't rely on
 * a second capture-phase look at the key. Instead this component subscribes to
 * `useMailStore`'s `composeInit` (the one deliberate exception to "no store
 * subscriptions for progress" — noted in DECISIONS D7) and advances the tutorial
 * when composeInit flips from non-null to null while step 7 is active.
 */
export function Tutorial() {
  useTutorialAutoStart();

  const tutorialActive = useCoachStore((s) => s.tutorialActive);
  const tutorialStep = useCoachStore((s) => s.tutorialStep);
  const exitTutorial = useCoachStore((s) => s.exitTutorial);

  // Window capture-phase key mediator — only attached while the tutorial is active;
  // removing it on cleanup is the kill switch back to normal shortcut behavior.
  useEffect(() => {
    if (!tutorialActive) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const lower = e.key.toLowerCase();
      const { tutorialStep: step, advanceTutorial, exitTutorial } = useCoachStore.getState();
      const current = TUTORIAL_STEPS[step];

      if (lower === 'e' || lower === '#') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (current?.keys.some((k) => k.toLowerCase() === lower)) advanceTutorial();
        return;
      }

      if (!current) return; // completion card showing — nothing left to mediate

      if (e.key === 'Escape') {
        const isStepKey = current.keys.some((k) => k.toLowerCase() === 'escape');
        if (isStepKey) {
          advanceTutorial();
          return; // untouched — real closeThread / Compose-close effect follows
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        exitTutorial(false);
        return;
      }

      if (current.keys.some((k) => k.toLowerCase() === lower)) advanceTutorial();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [tutorialActive]);

  // Step 7 exception (see doc comment above): detect Compose closing via store
  // subscription instead of key detection, because isTyping short-circuits the
  // capture handler while the compose fields are focused.
  useEffect(() => {
    if (!tutorialActive || DISCARD_STEP_INDEX < 0) return;
    let prevComposeInit = useMailStore.getState().composeInit;
    const unsubscribe = useMailStore.subscribe((state) => {
      const wasOpen = prevComposeInit !== null;
      prevComposeInit = state.composeInit;
      if (!wasOpen || state.composeInit !== null) return;
      const coach = useCoachStore.getState();
      if (coach.tutorialActive && coach.tutorialStep === DISCARD_STEP_INDEX) {
        coach.advanceTutorial();
      }
    });
    return unsubscribe;
  }, [tutorialActive]);

  if (!tutorialActive) return null;

  const current = TUTORIAL_STEPS[tutorialStep];

  return (
    <div className="pointer-events-auto absolute bottom-32 left-1/2 z-50 -translate-x-1/2">
      {current ? (
        <div className="zen-fade-in flex w-80 flex-col gap-2 rounded-lg border border-bg-border bg-bg-subtle px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wider text-text-muted uppercase">
              Step {tutorialStep + 1} / {TUTORIAL_STEPS.length}
            </span>
            <span className="text-[11px] text-text-muted">Skip tour (Esc)</span>
          </div>
          <div className="text-[13px] font-semibold text-text-primary">{current.title}</div>
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <span className="flex gap-1">
              {current.keys.map((k, i) => (
                <kbd
                  key={i}
                  className="rounded border border-bg-border bg-bg px-1.5 py-0.5 font-sans text-[10px] text-text-muted"
                >
                  {k}
                </kbd>
              ))}
            </span>
            <span>{current.body}</span>
          </div>
        </div>
      ) : (
        <div className="zen-fade-in flex w-80 flex-col gap-3 rounded-lg border border-bg-border bg-bg-subtle px-4 py-3 shadow-2xl">
          <div className="text-[13px] font-semibold text-text-primary">
            You're ready — press <kbd className="rounded border border-bg-border bg-bg px-1.5 py-0.5 font-sans text-[10px] text-text-muted">?</kbd> anytime for the cheat sheet.
          </div>
          <button
            onClick={() => exitTutorial(true)}
            className="self-start rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
