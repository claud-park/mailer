import { app, Notification, type BrowserWindow } from 'electron';
import type { ThreadSummary } from '../shared/types';
import type { AccountContext } from './ipc';

/**
 * new-mail-alerts D9: 계정 하나 분량의 "현재 Inbox∪Starred unread 스레드 목록"과 "마지막으로 관측한
 * ID 집합"을 비교해 진짜 신규분만 골라내는 순수 함수(vitest 대상). lastKnownIds===undefined는 이
 * 계정에 대한 최초 관측 — baseline만 시딩하고 알림은 쏘지 않는다(콜드스타트 안전, R6).
 */
export function diffNewUnread(
  current: ThreadSummary[],
  lastKnownIds: Set<string> | undefined
): { newThreads: ThreadSummary[]; nextIds: Set<string> } {
  const nextIds = new Set(current.map((t) => t.id));
  if (lastKnownIds === undefined) return { newThreads: [], nextIds };
  const newThreads = current.filter((t) => !lastKnownIds.has(t.id));
  return { newThreads, nextIds };
}

/** D1: 전 계정(활성/비활성 무관) unreadCount 합산 → macOS Dock 배지. 포커스 여부와 무관하게 항상 실행. */
export function updateDockBadge(contexts: AccountContext[]): void {
  const total = contexts.reduce((n, c) => n + c.unreadCount, 0);
  app.setBadgeCount(total);
}

// E2E-only (TC-ALT-D1/D2): real OS window focus is not reliably controllable from an automated
// CDP harness (no window-manager guarantee in CI/headless runs), so the D5 focus gate below reads
// this override instead of getWindow()?.isFocused() whenever it has been explicitly set. null (the
// default) means "use the real focus state" — production behavior is completely unaffected since
// this is only ever flipped by the ZENMAIL_E2E_PORT-gated mail:debug-set-window-focused handler.
let debugFocusOverride: boolean | null = null;
export function setDebugFocusOverride(v: boolean | null): void {
  debugFocusOverride = v;
}

// E2E-only (TC-ALT-B1/B2, D1/D2): native OS Notification objects have no CDP-visible surface — Playwright
// cannot inspect whether a banner fired, let alone read its title/body. This in-memory log records
// every notification fireNewMailNotification actually decided to show (i.e. past the D5 focus gate),
// so E2E can assert count/title/body via mail:debug-notification-log (ipc.ts) without touching a
// real OS banner. Only populated under ZENMAIL_E2E_PORT — unbounded growth would otherwise leak
// memory over a real, long-running session.
export const debugNotificationLog: Array<{ title: string; body: string }> = [];

/**
 * D3/D4/D5: 새 메일 OS 알림 발화 — 앱이 이미 포커스 중이면 스킵(배지는 updateDockBadge가 이 조건과
 * 무관하게 별도로 갱신). 신규 unread 스레드 총합이 정확히 1건이면 발신자+제목을 그대로 노출하는
 * 개별 알림, 2건 이상이면 "OO 외 N건" 그룹 알림 1개(계정 경계 없이 전역 합산, D1). 클릭 시
 * `notify:activate`를 렌더러로 보낸다 — 개별은 그 스레드의 accountId/threadId, 그룹은 둘 다 null
 * (활성 계정 Inbox로만 이동, 계정 자동전환 없음 — 렌더러 쪽 처리는 CP2 담당).
 */
export function fireNewMailNotification(
  perAccountNew: Array<{ accountId: string; threads: ThreadSummary[] }>,
  getWindow: () => BrowserWindow | null
): void {
  const focused = debugFocusOverride !== null ? debugFocusOverride : !!getWindow()?.isFocused();
  if (focused) return; // D5: 포커스 중엔 억제

  const flat = perAccountNew.flatMap(({ accountId, threads }) =>
    threads.map((thread) => ({ accountId, thread }))
  );
  if (flat.length === 0) return;

  if (flat.length === 1) {
    const { accountId, thread } = flat[0];
    const title = thread.from.name || thread.from.email;
    const body = thread.subject;
    if (process.env.ZENMAIL_E2E_PORT) debugNotificationLog.push({ title, body });
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      getWindow()?.show();
      getWindow()?.webContents.send('notify:activate', { accountId, threadId: thread.id });
    });
    notification.show();
    return;
  }

  const firstSender = flat[0].thread.from.name || flat[0].thread.from.email;
  const title = `${firstSender} 외 ${flat.length - 1}건`;
  const body = `새 메일 ${flat.length}건`;
  if (process.env.ZENMAIL_E2E_PORT) debugNotificationLog.push({ title, body });
  const notification = new Notification({ title, body });
  notification.on('click', () => {
    getWindow()?.show();
    getWindow()?.webContents.send('notify:activate', { accountId: null, threadId: null });
  });
  notification.show();
}
