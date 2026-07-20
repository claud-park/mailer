import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockGmailProvider, NEW_MAIL_QUERY, type GmailProvider } from './gmail';
import { AccountCache } from './cache';
import { __setUserDataDirForTests, imageCacheDir } from './accounts';
import type { AccountContext } from './ipc';

// snooze.ts only pulls in electron at runtime via notify.ts (app.setBadgeCount) and
// sync-state.ts (type-only, erased) — stub the pieces the daemon tick actually touches so this
// test can run under plain vitest/Node without a real Electron process.
vi.mock('electron', () => {
  class FakeNotification {
    on = vi.fn();
    show = vi.fn();
    constructor(_opts: unknown) {}
  }
  return { app: { setBadgeCount: vi.fn() }, Notification: FakeNotification };
});

// remote-image-prefetch Task 6: the daemon hook (prefetchNewThreadImages) delegates the actual
// network fetch/cache-write to image-cache's `prefetch` — that wiring (not image-cache's own
// fetch/SSRF-guard mechanics, already covered by image-cache.test.ts) is what this file verifies.
// A real local http server can't stand in here the way Task 4's tests do it: snooze.ts's hook
// calls `prefetch(...)` without an isAllowed override, so the default isPrefetchableUrl guard
// would just block a loopback test server outright — spying on the export is the only way to
// observe the daemon → image-cache call without that guard getting in the way.
vi.mock('./image-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-cache')>();
  return { ...actual, prefetch: vi.fn().mockResolvedValue(undefined) };
});

import { prefetch } from './image-cache';
import { runDaemonTickNow, startSnoozeDaemon, stopSnoozeDaemon } from './snooze';

describe('snooze daemon — remote image prefetch on new-unread detection', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-snooze-'));
    __setUserDataDirForTests(dir);
    vi.mocked(prefetch).mockClear();
  });

  afterEach(() => {
    stopSnoozeDaemon();
    __setUserDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prefetches remote images from newly-detected unread threads', async () => {
    const email = 'demo@zenmail.app';
    const provider = new MockGmailProvider(email);
    // Demo data ships with its own pre-existing unread INBOX threads — seed the baseline from
    // *before* injecting, exactly as a real account's ctx.lastKnownUnreadIds/unreadCount would
    // already reflect the prior tick's observation. Only the freshly injected thread should then
    // diff as "new" (matching the brief's Arrange: inboxUnreadCount rises by exactly one).
    const baselineCount = await provider.inboxUnreadCount();
    const { threads: baselineThreads } = await provider.listThreads({ q: NEW_MAIL_QUERY });
    const baselineIds = new Set(baselineThreads.map((t) => t.id));

    provider.injectNewMail({ from: 'sender@example.com', subject: 'Hello' });
    // injectNewMail's bodyHtml is demoBody() (no remote <img>) — override getThread to inject one.
    const originalGetThread = provider.getThread.bind(provider);
    provider.getThread = async (threadId: string) => {
      const detail = await originalGetThread(threadId);
      const last = detail.messages[detail.messages.length - 1];
      last.bodyHtml = '<div><img src="https://example.com/logo.png"></div>';
      return detail;
    };

    const cache = new AccountCache(path.join(dir, 'a.db'));
    const ctx: AccountContext & { provider: GmailProvider } = {
      email,
      demo: true,
      provider,
      calendarProvider: null,
      calendarReady: false,
      cache,
      needsReauth: false,
      unreadCount: baselineCount,
      lastKnownUnreadIds: baselineIds,
    };

    // Start the daemon against an empty context list first — with zero contexts the tick body
    // never reaches an await, so startSnoozeDaemon's own fire-and-forget initial tick runs fully
    // synchronously to completion before this call returns. That avoids racing it against the
    // real, awaited tick triggered below via runDaemonTickNow().
    let contexts: AccountContext[] = [];
    startSnoozeDaemon(() => contexts, () => null, () => {});
    contexts = [ctx];

    await runDaemonTickNow();

    // The hook is deliberately fire-and-forget (void prefetchNewThreadImages(...).catch(...)) so
    // it doesn't delay the tick's own return timing (D-note in the brief's Step 6) — runDaemonTickNow
    // resolving only means the tick's synchronous badge/notification work is done, not that this
    // background prefetch (which still has its own getThread + prefetch awaits pending) has
    // finished. Poll for it instead of asserting immediately.
    await vi.waitFor(
      () => {
        expect(prefetch).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 }
    );
    expect(prefetch).toHaveBeenCalledWith(cache, imageCacheDir(email), ['https://example.com/logo.png']);
  });

  it('does not prefetch when no new unread thread is detected', async () => {
    const email = 'demo2@zenmail.app';
    const provider = new MockGmailProvider(email);
    const cache = new AccountCache(path.join(dir, 'a.db'));
    const ctx: AccountContext & { provider: GmailProvider } = {
      email,
      demo: true,
      provider,
      calendarProvider: null,
      calendarReady: false,
      cache,
      needsReauth: false,
      unreadCount: await provider.inboxUnreadCount(), // baseline already matches current count — no rise
      lastKnownUnreadIds: new Set(),
    };

    let contexts: AccountContext[] = [];
    startSnoozeDaemon(() => contexts, () => null, () => {});
    contexts = [ctx];

    await runDaemonTickNow();

    expect(prefetch).not.toHaveBeenCalled();
  });
});
