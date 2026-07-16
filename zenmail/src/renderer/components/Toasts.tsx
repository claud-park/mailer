import { useEffect, useState } from 'react';
import { useMailStore } from '../store/mail';

function UndoSendToast() {
  const pendingSend = useMailStore((s) => s.pendingSend);
  const undoSend = useMailStore((s) => s.undoSend);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!pendingSend) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((pendingSend.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [pendingSend]);

  if (!pendingSend) return null;
  return (
    <div className="zen-fade-in flex items-center gap-3 rounded-lg border border-bg-border bg-bg-subtle px-4 py-2 shadow-xl">
      <span className="text-[13px] text-text-primary">Sending in {remaining}s…</span>
      <button
        onClick={() => void undoSend()}
        className="rounded bg-bg-border px-2 py-0.5 text-[12px] font-medium text-accent hover:text-accent-hover"
      >
        Undo
      </button>
    </div>
  );
}

export function Toasts() {
  const toast = useMailStore((s) => s.toast);
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toast && (
        <div className="zen-fade-in flex items-center gap-3 rounded-lg border border-bg-border bg-bg-subtle px-4 py-2 text-[13px] text-text-primary shadow-xl">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo!();
                // 즉시 비워서 더블클릭으로 undo가 두 번 실행되는 것을 막는다.
                useMailStore.setState({ toast: null });
              }}
              className="rounded bg-bg-border px-2 py-0.5 text-[12px] font-medium text-accent hover:text-accent-hover"
            >
              Undo
            </button>
          )}
        </div>
      )}
      <UndoSendToast />
    </div>
  );
}
