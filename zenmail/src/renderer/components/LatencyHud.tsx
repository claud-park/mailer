import { useEffect, useState, useSyncExternalStore } from 'react';
import { latencySnapshot, isHudOpen, subscribeHud } from '../store/latency';

type Row = {
  action: string;
  count: number;
  p50: number | null;
  p95: number | null;
  overBudget: number;
  rollbacks: number;
};

function fmt(ms: number | null): string {
  return ms === null ? '–' : `${Math.round(ms)}`;
}

function buildRows(): Row[] {
  const { actions, rollbacks } = latencySnapshot();
  return Object.entries(actions).map(([action, stat]) => ({
    action,
    count: stat.count,
    p50: stat.p50,
    p95: stat.p95,
    overBudget: stat.overBudget,
    rollbacks: rollbacks[action as keyof typeof rollbacks] ?? 0,
  }));
}

/**
 * Hidden diagnostic overlay (F4 CP5, DECISIONS D8). Toggled by ⌘⌥⇧L
 * (handled in useKeyboard.ts, not advertised in kbar). Read-only, non-modal —
 * never steals focus and polls only while visible.
 */
export function LatencyHud() {
  const open = useSyncExternalStore(subscribeHud, isHudOpen);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(buildRows());
    const id = setInterval(() => setRows(buildRows()), 500);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-[9999] max-h-[60vh] w-[420px] overflow-y-auto rounded-md border border-bg-border bg-black/85 p-2 font-mono text-[10px] text-green-300 shadow-2xl"
      aria-hidden="true"
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="pr-2">action</th>
            <th className="pr-2 text-right">n</th>
            <th className="pr-2 text-right">p50</th>
            <th className="pr-2 text-right">p95</th>
            <th className="pr-2 text-right">&gt;budget</th>
            <th className="text-right">rollback</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-text-muted">
                no samples yet
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.action}>
                <td className="pr-2">{row.action}</td>
                <td className="pr-2 text-right tabular-nums">{row.count}</td>
                <td className="pr-2 text-right tabular-nums">{fmt(row.p50)}</td>
                <td className="pr-2 text-right tabular-nums">{fmt(row.p95)}</td>
                <td className="pr-2 text-right tabular-nums">{row.overBudget}</td>
                <td className="text-right tabular-nums">{row.rollbacks}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
