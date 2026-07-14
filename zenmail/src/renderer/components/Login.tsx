import { useState } from 'react';
import { useMailStore } from '../store/mail';

export function Login() {
  const addAccount = useMailStore((s) => s.addAccount);
  const signInDemo = useMailStore((s) => s.signInDemo);
  const authError = useMailStore((s) => s.authError);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-drag flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="mb-2 text-4xl">🪷</div>
        <h1 className="text-xl font-semibold text-text-primary">ZenMail</h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          Keep it zen. No AI. No noise. Just email.
        </p>
      </div>

      <div className="app-no-drag flex flex-col items-center gap-3">
        <button
          onClick={() => void run(addAccount)}
          disabled={busy}
          className="rounded-md bg-accent px-6 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Waiting for Google…' : 'Sign in with Google'}
        </button>
        <button
          onClick={() => void run(signInDemo)}
          disabled={busy}
          className="text-[12px] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          Continue in demo mode
        </button>
      </div>

      {authError && (
        <p className="app-no-drag max-w-md text-center text-[12px] text-label-red">{authError}</p>
      )}
      <p className="max-w-sm text-center text-[11px] text-text-muted">
        Google sign-in requires a <code>GOOGLE_CLIENT_ID</code> (Desktop-app OAuth client).
        Demo mode runs entirely offline with sample mail.
      </p>
    </div>
  );
}
