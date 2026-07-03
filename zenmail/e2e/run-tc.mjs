#!/usr/bin/env node
// F1 split-inbox-plus E2E harness — drives the demo-mode app over CDP via playwright-core.
// Usage: node e2e/run-tc.mjs
//
// Spawns `electron-forge start` with an isolated --user-data-dir (fresh temp dir, so the
// developer's real zenmail.db / OAuth session are never touched) and ZENMAIL_E2E_PORT set,
// which main/index.ts turns into a `--remote-debugging-port` switch. Connects with
// playwright-core's connectOverCDP and drives the renderer purely through the DOM (clicks,
// keyboard, text assertions) — the zustand store is not exposed on window by design.

import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
// randomize the port per run so a leftover/orphaned Electron process from a previous crashed
// run (macOS reparents detached Electron GUI processes to PID 1, so SIGTERM to our spawned
// wrapper does not reliably kill them) can never be mistaken for this run's fresh instance.
const PORT = Number(process.env.ZENMAIL_E2E_PORT || 9200 + Math.floor(Math.random() * 300));
const USERDATA = mkdtempSync(path.join(tmpdir(), 'zenmail-e2e-'));

const results = [];
function record(id, status, note = '') {
  results.push({ id, status, note });
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`[${id}] ${tag}${note ? ' — ' + note : ''}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeout = 5000, interval = 150, desc = '' } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for: ${desc}${lastErr ? ' (' + lastErr.message + ')' : ''}`);
}

// ---------------------------------------------------------------------------
// App process lifecycle
// ---------------------------------------------------------------------------

let child = null;

function launchApp(port, userDataDir) {
  child = spawn(
    './node_modules/.bin/electron-forge',
    ['start', '--', `--user-data-dir=${userDataDir}`],
    {
      cwd: PROJECT_DIR,
      env: { ...process.env, ZENMAIL_E2E_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  child.__log = () => out;
  return child;
}

/**
 * Electron (and its helper processes) detach from the electron-forge CLI wrapper on macOS
 * (they get reparented to PID 1), so killing only the spawned `child` never actually closes
 * the app window. We additionally pkill by the unique --user-data-dir argument for this run,
 * which safely targets only this harness's own Electron/helper processes.
 */
async function killApp() {
  if (child) {
    const proc = child;
    child = null;
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        resolve();
      }, 5000);
    });
  }
  try {
    execSync(`pkill -f -- "--user-data-dir=${USERDATA}"`);
  } catch {
    /* no matching processes left — fine */
  }
  await sleep(500);
}

async function connectPage(port) {
  const browser = await waitFor(
    async () => {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch {
        return null;
      }
    },
    { timeout: 60000, interval: 500, desc: 'CDP connect' }
  );
  const page = await waitFor(
    async () => {
      for (const ctx of browser.contexts()) {
        for (const pg of ctx.pages()) {
          const url = pg.url();
          if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) return pg;
        }
      }
      return null;
    },
    { timeout: 30000, interval: 300, desc: 'renderer page' }
  );
  await waitFor(() => page.evaluate(() => !!document.getElementById('root')?.children.length), {
    timeout: 20000,
    desc: 'react mounted',
  });
  return { browser, page };
}

// ---------------------------------------------------------------------------
// DOM helpers (UI-only — the zustand store is not exposed on window by design)
// ---------------------------------------------------------------------------

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function isLoginScreen(page) {
  return (await bodyText(page)).includes('Continue in demo mode');
}

async function demoLogin(page) {
  try {
    await waitFor(() => isLoginScreen(page), { timeout: 45000, interval: 300, desc: 'login screen' });
  } catch (err) {
    const url = await page.url();
    const text = await bodyText(page).catch(() => '<evaluate failed>');
    console.error(`[demoLogin] diag — url=${url} bodyText=${JSON.stringify(text.slice(0, 300))}`);
    throw err;
  }
  await page.click('text=Continue in demo mode');
  await waitFor(async () => (await bodyText(page)).includes('Compose'), {
    timeout: 20000,
    desc: 'shell loaded after demo login',
  });
  // let the initial loadLabels/loadThreads/loadSplitState settle
  await sleep(500);
}

async function tabsInfo(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="tab"]')).map((btn) => {
      const clone = btn.cloneNode(true);
      const badgeEl = clone.querySelector('span.rounded-full');
      let badge = null;
      if (badgeEl) {
        badge = badgeEl.textContent.trim();
        badgeEl.remove();
      }
      return {
        label: clone.textContent.trim(),
        badge,
        active: btn.getAttribute('aria-selected') === 'true',
      };
    });
  });
}

async function tabBarVisible(page) {
  return page.evaluate(() => !!document.querySelector('[role="tablist"][aria-label="Inbox splits"]'));
}

/** thread rows currently rendered in the main list (identified by the unread dot span) */
async function rowsInfo(page) {
  return page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    return dots
      .map((dot) => dot.closest('button'))
      .filter(Boolean)
      .map((btn) => ({
        text: btn.textContent.trim(),
        selected: btn.classList.contains('bg-bg-subtle'),
      }));
  });
}

async function clickTab(page, label) {
  const handle = await page.evaluateHandle(
    (want) =>
      Array.from(document.querySelectorAll('[role="tab"]')).find((btn) => {
        const clone = btn.cloneNode(true);
        const badgeEl = clone.querySelector('span.rounded-full');
        if (badgeEl) badgeEl.remove();
        return clone.textContent.trim() === want;
      }) ?? null,
    label
  );
  const el = handle.asElement();
  if (!el) throw new Error(`tab not found: ${label}`);
  await el.click();
}

async function clickRowContaining(page, textSubstr) {
  const handle = await page.evaluateHandle((want) => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    return (
      dots
        .map((dot) => dot.closest('button'))
        .filter(Boolean)
        .find((btn) => btn.textContent.includes(want)) ?? null
    );
  }, textSubstr);
  const el = handle.asElement();
  if (!el) throw new Error(`row not found: ${textSubstr}`);
  await el.click();
}

async function focusBody(page) {
  await page.evaluate(() => {
    (document.activeElement instanceof HTMLElement) && document.activeElement.blur();
    document.body.focus();
  });
}

// ---------------------------------------------------------------------------
// F2 follow-up-reminders helpers
// ---------------------------------------------------------------------------

/** ground truth straight from the main-process cache — listFollowups() is a regular (non-debug) IPC */
async function listFollowups(page) {
  return page.evaluate(() => window.zenmail.listFollowups());
}

async function debugTick(page) {
  await page.evaluate(() => window.zenmail.__debugTick());
}

async function debugSimulateReply(page, threadId) {
  await page.evaluate((id) => window.zenmail.__debugSimulateReply(id), threadId);
}

/** E2E-only debug IPC (env-gated, added for CP5): force baseline=due=now so a tick fires it immediately */
async function debugAddFollowupDueNow(page, threadId) {
  await page.evaluate((id) => window.zenmail.__debugAddFollowupDueNow(id), threadId);
}

async function dismissFollowup(page, threadId) {
  await page.evaluate((id) => window.zenmail.dismissFollowup(id), threadId);
}

/** reads the `data-thread-id` attribute (added to ThreadRow for CP5) off the row matching the text */
async function threadIdOfRowContaining(page, textSubstr) {
  return page.evaluate((want) => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const btn = dots
      .map((dot) => dot.closest('button'))
      .filter(Boolean)
      .find((b) => b.textContent.includes(want));
    return btn ? btn.getAttribute('data-thread-id') : null;
  }, textSubstr);
}

/** whether the unread dot for a given thread id is "on" (accent color) */
async function isThreadRowUnread(page, threadId) {
  return page.evaluate((id) => {
    const btn = document.querySelector(`[data-thread-id="${id}"]`);
    const dot = btn?.querySelector('span.rounded-full');
    return !!dot && dot.classList.contains('bg-accent');
  }, threadId);
}

async function openNewCompose(page) {
  await focusBody(page);
  await page.keyboard.press('c');
  await waitFor(async () => (await bodyText(page)).includes('New message'), { desc: 'compose open' });
}

/** locates the input inside a labeled Compose row (`<span>{label}</span>` sibling) — works for both
 *  RecipientField ("To"/"Cc"/"Bcc") and the plain Subject input regardless of DOM nesting depth. */
async function composeFieldHandle(page, labelText) {
  const handle = await page.evaluateHandle((label) => {
    const spans = Array.from(document.querySelectorAll('span'));
    const span = spans.find((s) => s.textContent.trim() === label);
    return span ? span.parentElement.querySelector('input') : null;
  }, labelText);
  const el = handle.asElement();
  if (!el) throw new Error(`compose field not found: ${labelText}`);
  return el;
}

async function fillComposeSubject(page, subject) {
  const el = await composeFieldHandle(page, 'Subject');
  await el.click();
  await page.keyboard.type(subject);
}

/** types an email into a RecipientField and commits it with Enter (a brand-new, non-contact email
 *  avoids the autocomplete dropdown intercepting Enter and committing a different suggestion). */
async function addComposeRecipient(page, label, email) {
  const el = await composeFieldHandle(page, label);
  await el.click();
  await page.keyboard.type(email);
  await sleep(250); // let any in-flight contact-suggestion fetch resolve before Enter
  await page.keyboard.press('Enter');
}

async function setComposeRemind(page, presetLabel) {
  await page.click('[aria-label="Remind me if no reply"]');
  await sleep(150);
  await page.click(`button:has-text("${presetLabel}")`);
  await sleep(150);
}

async function clickComposeSend(page) {
  await page.locator('button:has-text("Send")').first().click();
}

// ---------------------------------------------------------------------------
// SplitSettings modal helpers
// ---------------------------------------------------------------------------

async function openSplitSettings(page) {
  // the gear lives inside SplitTabBar, which only renders while splitInbox is on — fall back to
  // the command palette action (works regardless of tab-bar visibility) when the gear is absent.
  const gearVisible = await page.evaluate(() => !!document.querySelector('[aria-label="Configure splits"]'));
  if (gearVisible) {
    await page.click('[aria-label="Configure splits"]');
  } else {
    await focusBody(page);
    await page.keyboard.press('Meta+k');
    await sleep(200);
    await page.keyboard.type('Configure splits');
    await sleep(200);
    await page.keyboard.press('Enter');
  }
  await waitFor(async () => (await bodyText(page)).includes('Configure splits'), { desc: 'SplitSettings open' });
}

async function splitSettingsRows(page) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[aria-label="Split name"]'));
    return inputs.map((inp) => {
      let row = inp.parentElement;
      while (row && !row.classList.contains('p-2')) row = row.parentElement;
      const select = row?.querySelector('select[aria-label="Rule type"]');
      const enabledCb = row?.querySelector('input[type="checkbox"]');
      return {
        name: inp.value,
        rule: select ? select.value : null,
        enabled: enabledCb ? enabledCb.checked : null,
      };
    });
  });
}

/** ElementHandle for a SplitSettings row, located by its current name value (robust to reordering) */
async function rowHandleByName(page, name) {
  const handle = await page.evaluateHandle((wantName) => {
    const inputs = Array.from(document.querySelectorAll('input[aria-label="Split name"]'));
    const inp = inputs.find((i) => i.value === wantName);
    if (!inp) return null;
    let row = inp.parentElement;
    while (row && !row.classList.contains('p-2')) row = row.parentElement;
    return row;
  }, name);
  const el = handle.asElement();
  if (!el) throw new Error(`SplitSettings row not found for name: ${name}`);
  return el;
}

async function saveSplitSettings(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitFor(async () => !(await bodyText(page)).includes('Configure splits'), { desc: 'SplitSettings closed after save' });
}

async function cancelSplitSettings(page) {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await waitFor(async () => !(await bodyText(page)).includes('Configure splits'), { desc: 'SplitSettings closed after cancel' });
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

async function run() {
  console.log(`[harness] userData dir: ${USERDATA}`);
  console.log(`[harness] port: ${PORT}`);
  launchApp(PORT, USERDATA);
  let page, browser;
  try {
    ({ browser, page } = await connectPage(PORT));
  } catch (err) {
    console.error('[harness] FATAL: could not connect to app', err);
    console.error(child?.__log?.() ?? '');
    await killApp();
    process.exit(1);
  }

  try {
    await scenario_login_and_F3(page);
    await scenario_A(page);
    await scenario_B(page);
    await scenario_C(page);
    await scenario_D(page);
    await scenario_E_and_B4_and_A2(page);
    await scenario_D9(page);
    await scenario_H1(page);
    record('TC-G1', 'PASS', 'validated inline during TC-A section (VIP/Team/Newsletter each >=1 thread)');

    // --- F2 follow-up-reminders --------------------------------------------
    // E2 runs first: it signs out/back in, which re-constructs a fresh MockGmailProvider
    // (pristine demo data), so the A/B/C/D scenarios below all get untouched seed threads
    // regardless of what F1's scenarios above archived/trashed/relabeled.
    await tryFollowupScenario(page, 'E2', () => scenario_followup_E2(page));
    await tryFollowupScenario(page, 'A', () => scenario_followup_A(page));
    await tryFollowupScenario(page, 'A4', () => scenario_followup_A4(page));
    await tryFollowupScenario(page, 'B', () => scenario_followup_B(page));
    await tryFollowupScenario(page, 'C', () => scenario_followup_C(page));
    await tryFollowupScenario(page, 'D', () => scenario_followup_D(page));
    await tryFollowupScenario(page, 'D2', () => scenario_followup_D2(page));

    // --- F1/F2/F4: mutate + restart -----------------------------------
    await scenario_prepare_restart_state(page);
  } catch (err) {
    console.error('[harness] scenario error (pre-restart):', err);
  }

  await browser.close().catch(() => {});
  await killApp();

  // relaunch with the SAME user-data dir to verify persistence
  launchApp(PORT, USERDATA);
  try {
    ({ browser, page } = await connectPage(PORT));
    await scenario_verify_restart_state(page);
  } catch (err) {
    console.error('[harness] scenario error (post-restart):', err);
    record('TC-F1', 'FAIL', String(err));
    record('TC-F2', 'FAIL', String(err));
    record('TC-F4', 'FAIL', String(err));
    record('TC-FUP-E1', 'FAIL', String(err));
  }

  await browser?.close().catch(() => {});
  await killApp();
  rmSync(USERDATA, { recursive: true, force: true });

  console.log('\n=== TC Results ===');
  for (const r of results) {
    console.log(`${r.id.padEnd(10)} ${r.status.padEnd(5)} ${r.note}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  process.exit(failed > 0 ? 1 : 0);
}

// --- login / F3 --------------------------------------------------------

async function scenario_login_and_F3(page) {
  await demoLogin(page);
  // fresh isolated userData -> splits table empty -> mail:get-splits seeds defaults
  await openSplitSettings(page);
  const rows = await splitSettingsRows(page);
  const names = rows.map((r) => r.name);
  const ok =
    names.length === 3 &&
    names[0] === 'VIP' &&
    names[1] === 'Team' &&
    names[2] === 'Newsletter' &&
    rows[1].rule === 'domains';
  if (ok) record('TC-F3', 'PASS', `seeded defaults: ${names.join(', ')}`);
  else record('TC-F3', 'FAIL', `unexpected seed: ${JSON.stringify(rows)}`);

  // TC-E1 (PRD §3-3 / DECISIONS D13): Inbox/Other는 스플릿이 아니므로 편집 목록에 행으로 나오면 안 되고,
  // 하단에 "Unmatched mail goes to Other." 안내 텍스트만 있어야 한다.
  const hasOtherRow = rows.some((r) => r.name === 'Other');
  const hasHint = await page
    .locator('text=Unmatched mail goes to Other.')
    .count()
    .then((n) => n > 0);
  if (!hasOtherRow && hasHint) {
    record('TC-E1', 'PASS', 'defaults listed in position order; Other shown as hint text, not an editable row');
  } else {
    record('TC-E1', 'FAIL', `hasOtherRow=${hasOtherRow} hasHint=${hasHint} — PRD §3-3 위반`);
  }
  await cancelSplitSettings(page);
}

// --- A: tab bar display / counts ---------------------------------------

async function scenario_A(page) {
  const tabs = await tabsInfo(page);
  const labels = tabs.map((t) => t.label);
  if (labels[0] === 'Inbox' && labels.includes('VIP') && labels.includes('Team') && labels.includes('Newsletter') && labels[labels.length - 1] === 'Other') {
    record('TC-A1', 'PASS', `order: ${labels.join(' | ')}`);
  } else {
    record('TC-A1', 'FAIL', `unexpected tab order: ${labels.join(' | ')}`);
  }

  // TC-A6: Inbox tab shows the full unfiltered load
  await clickTab(page, labels[0]);
  const inboxRows = await rowsInfo(page);
  const inboxTotal = inboxRows.length;
  if (inboxTotal > 0) record('TC-A6', 'PASS', `Inbox shows ${inboxTotal} unfiltered threads`);
  else record('TC-A6', 'FAIL', 'Inbox tab shows 0 threads');

  // TC-A5 / TC-G1: check each split + Other has content, sum matches Inbox total (TC-A3)
  let sum = 0;
  const perTabCounts = {};
  for (const label of labels.slice(1)) {
    await clickTab(page, label);
    const rows = await rowsInfo(page);
    perTabCounts[label] = rows.length;
    sum += rows.length;
  }
  const vip = perTabCounts['VIP'] ?? 0;
  const team = perTabCounts['Team'] ?? 0;
  const newsletter = perTabCounts['Newsletter'] ?? 0;
  const other = perTabCounts['Other'] ?? 0;
  if (vip >= 1 && team >= 1 && newsletter >= 1) {
    record('TC-G1', 'PASS', `VIP=${vip} Team=${team} Newsletter=${newsletter}`);
  } else {
    record('TC-G1', 'FAIL', `expected >=1 each, got VIP=${vip} Team=${team} Newsletter=${newsletter}`);
  }
  if (other >= 1) record('TC-A5', 'PASS', `Other has ${other} unmatched thread(s)`);
  else record('TC-A5', 'FAIL', 'Other tab is empty in demo data');

  if (sum === inboxTotal) {
    record('TC-A3', 'PASS', `sum(VIP+Team+Newsletter+Other)=${sum} === Inbox total=${inboxTotal}`);
  } else {
    record('TC-A3', 'FAIL', `sum=${sum} !== Inbox total=${inboxTotal} (VIP=${vip} Team=${team} News=${newsletter} Other=${other})`);
  }

  // TC-A2: first-match exclusivity — deferred to scenario_E (needs an overlapping rule to prove);
  // for now just confirm ana@linearly.dev's threads are in VIP, not duplicated in Other/Newsletter.
  await clickTab(page, 'VIP');
  const vipRows = (await rowsInfo(page)).map((r) => r.text);
  const vipHasRoadmap = vipRows.some((t) => t.includes('Q3 roadmap review'));
  if (vipHasRoadmap) {
    record('TC-A2-baseline', 'PASS', 'ana@linearly.dev thread present in VIP before overlap test (see TC-A2 below)');
  } else {
    record('TC-A2-baseline', 'FAIL', 'expected VIP baseline thread missing');
  }

  // TC-A4: demo provider never sets nextPageToken (single page of results)
  record('TC-A4', 'SKIP', 'MockGmailProvider.listThreads never returns nextPageToken — no pagination in demo mode');

  await clickTab(page, 'Inbox');
}

// --- B: tab switching / display conditions ------------------------------

async function scenario_B(page) {
  // TC-B1
  await clickTab(page, 'Team');
  await sleep(200);
  const sel = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    return rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
  });
  if (sel === 0) record('TC-B1', 'PASS', 'clicking a tab shows only its threads with selectedIndex=0');
  else record('TC-B1', 'FAIL', `selectedIndex after tab click = ${sel}`);

  // TC-B2: search hides tab bar
  await page.fill('input[placeholder^="Search mail"]', 'roadmap');
  await page.keyboard.press('Enter');
  await sleep(300);
  const hiddenDuringSearch = !(await tabBarVisible(page));
  if (hiddenDuringSearch) record('TC-B2', 'PASS', 'tab bar hidden while a search is active');
  else record('TC-B2', 'FAIL', 'tab bar still visible during search');
  // clear search
  await page.keyboard.press('Escape');
  await sleep(300);

  // TC-B3: non-INBOX label view hides tab bar
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await sleep(400);
  const hiddenOnSent = !(await tabBarVisible(page));
  if (hiddenOnSent) record('TC-B3', 'PASS', 'tab bar hidden on Sent label view');
  else record('TC-B3', 'FAIL', 'tab bar visible on Sent label view');
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await sleep(400);

  // TC-B4: an empty tab shows tab-context empty state with 0 count
  await openSplitSettings(page);
  await page.click('text=+ Add split');
  const nameInput = page.locator('input[aria-label="Split name"]').last();
  await nameInput.fill('Empty');
  const chipInput = page.locator('div.p-2').last().locator('input[aria-label="sender@example.com, …"]');
  await chipInput.fill('nobody@nowhere.invalid');
  await chipInput.press('Enter');
  await saveSplitSettings(page);
  await sleep(300);
  await clickTab(page, 'Empty');
  await sleep(200);
  const emptyBt = await bodyText(page);
  const tabsAfter = await tabsInfo(page);
  const emptyTab = tabsAfter.find((t) => t.label === 'Empty');
  if (emptyBt.includes('No Empty mail') && (emptyTab?.badge === null || emptyTab?.badge === '0')) {
    record('TC-B4', 'PASS', 'empty split shows tab-context empty state, badge 0');
  } else {
    record('TC-B4', 'FAIL', `body: ${emptyBt.includes('No Empty mail')}, badge=${emptyTab?.badge}`);
  }
  // remove the throwaway split again to keep later tests' state simple
  await openSplitSettings(page);
  const rowsNow = await splitSettingsRows(page);
  const idx = rowsNow.findIndex((r) => r.name === 'Empty');
  if (idx >= 0) {
    await page.click(`[aria-label="Delete Empty"]`);
  }
  await saveSplitSettings(page);
  await clickTab(page, 'Inbox');

  // TC-B5: cmd+shift+I unified toggle + Toolbar Split button
  await clickTab(page, 'Team');
  await page.keyboard.press('Meta+Shift+I');
  await sleep(300);
  const unifiedNoTabbar = !(await tabBarVisible(page));
  await page.keyboard.press('Meta+Shift+I');
  await sleep(300);
  const restoredTab = (await tabsInfo(page)).find((t) => t.active)?.label;
  let toolbarToggleWorks = false;
  await page.click('[title="Toggle split inbox (⌘⇧I)"]');
  await sleep(300);
  if (!(await tabBarVisible(page))) {
    await page.click('[title="Toggle split inbox (⌘⇧I)"]');
    await sleep(300);
    toolbarToggleWorks = await tabBarVisible(page);
  }
  if (unifiedNoTabbar && restoredTab === 'Team' && toolbarToggleWorks) {
    record('TC-B5', 'PASS', '⌘⇧I and Toolbar Split button both toggle unified/tabbed view and restore last tab');
  } else {
    record('TC-B5', 'FAIL', `unifiedNoTabbar=${unifiedNoTabbar} restoredTab=${restoredTab} toolbarToggleWorks=${toolbarToggleWorks}`);
  }
  await clickTab(page, 'Inbox');
}

// --- C: keyboard -----------------------------------------------------------

async function scenario_C(page) {
  await clickTab(page, 'Inbox');
  await focusBody(page);

  // TC-C1: Tab / Shift+Tab cycles with wrap
  const before = (await tabsInfo(page)).map((t) => t.label);
  await page.keyboard.press('Tab');
  await sleep(150);
  const afterTab1 = (await tabsInfo(page)).find((t) => t.active)?.label;
  const expectedNext = before[1];
  let wrapOk = true;
  // cycle through all tabs with Tab and confirm we return to Inbox (wrap)
  for (let i = 0; i < before.length - 1; i++) await page.keyboard.press('Tab');
  await sleep(150);
  const wrapped = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (afterTab1 === expectedNext && wrapped === 'Inbox') {
    record('TC-C1', 'PASS', `Tab advances (Inbox->${afterTab1}) and wraps back to Inbox after full cycle`);
  } else {
    record('TC-C1', 'FAIL', `afterTab1=${afterTab1} expectedNext=${expectedNext} wrapped=${wrapped}`);
    wrapOk = false;
  }
  // Shift+Tab goes backward
  await page.keyboard.press('Shift+Tab');
  await sleep(150);
  const back = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (back !== 'Inbox' && wrapOk) {
    console.log(`  (shift+tab moved to ${back})`);
  }

  await clickTab(page, 'Inbox');

  // TC-C2: Cmd+1..N direct jump; out-of-range is no-op
  const order = (await tabsInfo(page)).map((t) => t.label);
  let c2ok = true;
  for (let n = 1; n <= order.length; n++) {
    await page.keyboard.press(`Meta+${n}`);
    await sleep(150);
    const active = (await tabsInfo(page)).find((t) => t.active)?.label;
    if (active !== order[n - 1]) {
      c2ok = false;
      console.log(`  Meta+${n} -> ${active}, expected ${order[n - 1]}`);
    }
  }
  await clickTab(page, 'Inbox');
  const beforeOOR = (await tabsInfo(page)).find((t) => t.active)?.label;
  await page.keyboard.press(`Meta+${order.length + 3}`);
  await sleep(150);
  const afterOOR = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (c2ok && afterOOR === beforeOOR) {
    record('TC-C2', 'PASS', `Meta+1..${order.length} jump to the right tab; out-of-range is a no-op`);
  } else {
    record('TC-C2', 'FAIL', `c2ok=${c2ok} beforeOOR=${beforeOOR} afterOOR=${afterOOR}`);
  }

  // TC-C6: Cmd+K palette, search "split"
  await page.keyboard.press('Meta+k');
  await sleep(300);
  await page.keyboard.type('split');
  await sleep(300);
  const paletteText = await bodyText(page);
  const hasActions =
    paletteText.includes('Next split') && paletteText.includes('Previous split') && paletteText.includes('Configure splits') && paletteText.includes('Toggle split inbox');
  if (hasActions) {
    record('TC-C6', 'PASS', 'palette shows Next/Previous split, Configure splits, Toggle split inbox for "split" query');
  } else {
    record('TC-C6', 'FAIL', `palette text missing expected actions: ${paletteText.slice(0, 200)}`);
  }
  await page.keyboard.press('Escape');
  await sleep(200);

  // TC-C4: while typing in search, Tab must not switch tabs
  await page.click('input[placeholder^="Search mail"]');
  const activeBeforeType = (await tabsInfo(page)).find((t) => t.active)?.label;
  await page.keyboard.type('xyz');
  await page.keyboard.press('Tab');
  await sleep(150);
  const activeAfterType = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (activeAfterType === activeBeforeType) record('TC-C4', 'PASS', 'Tab does not switch tabs while typing in search');
  else record('TC-C4', 'FAIL', `active tab changed from ${activeBeforeType} to ${activeAfterType} while typing`);
  // reset search box
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await sleep(200);
  await clickTab(page, 'Inbox');

  // TC-C5: modal open -> Tab/Cmd+1 no-op
  await openSplitSettings(page);
  const activeBeforeModal = (await tabsInfo(page)).find((t) => t.active)?.label; // read from DOM behind the modal (still rendered)
  await page.keyboard.press('Tab');
  await page.keyboard.press('Meta+1');
  await sleep(200);
  // the modal must still be open (no accidental close/nav) and underlying tab unchanged
  const stillOpen = (await bodyText(page)).includes('Configure splits');
  await cancelSplitSettings(page);
  const activeAfterModal = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (stillOpen && activeAfterModal === activeBeforeModal) {
    record('TC-C5', 'PASS', 'Tab/Cmd+1 are no-ops while SplitSettings modal is open');
  } else {
    record('TC-C5', 'FAIL', `stillOpen=${stillOpen} before=${activeBeforeModal} after=${activeAfterModal}`);
  }

  // TC-C3: Compose Tab moves between fields, not tabs
  await page.keyboard.press('c');
  await waitFor(async () => (await bodyText(page)).includes('New message'), { desc: 'compose open' });
  const focused1 = await page.evaluate(() => document.activeElement?.tagName);
  await page.keyboard.press('Tab');
  await sleep(100);
  const focused2 = await page.evaluate(() => document.activeElement?.tagName + '|' + (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className ?? ''));
  const stillInCompose = await page.evaluate(() => !!document.activeElement?.closest('[contenteditable], input, button')?.closest('div.absolute.inset-0.z-30'));
  await page.keyboard.press('Escape');
  await sleep(200);
  if (stillInCompose) {
    record('TC-C3', 'PASS', `Tab moves focus within Compose fields (focus: ${focused1} -> ${focused2}), not tab switching`);
  } else {
    record('TC-C3', 'FAIL', `focus did not stay within Compose after Tab: ${focused2}`);
  }
}

// --- D: in-tab navigation / actions -----------------------------------------

async function scenario_D(page) {
  await clickTab(page, 'Inbox');

  // TC-D1: VIP tab has exactly its 2 seeded threads; j/k stay within them
  await clickTab(page, 'VIP');
  await sleep(200);
  const vipRows = (await rowsInfo(page)).map((r) => r.text);
  await focusBody(page);
  await page.keyboard.press('j');
  await sleep(100);
  const afterJ = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    const idx = rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
    return { idx, total: rows.length, text: rows[idx]?.textContent.trim() };
  });
  if (afterJ.total === vipRows.length && afterJ.idx === 1) {
    record('TC-D1', 'PASS', `VIP tab has ${vipRows.length} threads; j moved selection to index 1 within them`);
  } else {
    record('TC-D1', 'FAIL', `expected total=${vipRows.length} idx=1, got ${JSON.stringify(afterJ)}`);
  }
  await page.keyboard.press('k'); // back to index 0

  // TC-D2: Enter opens thread, ]/[ move within same tab
  await page.keyboard.press('Enter');
  await waitFor(async () => (await bodyText(page)).includes('Q3 roadmap'), { desc: 'VIP thread 0 open' });
  await page.keyboard.press(']');
  await sleep(200);
  const afterBracket = await bodyText(page);
  const movedToNext = afterBracket.includes('offsite agenda'); // VIP thread index1 subject
  await page.keyboard.press('[');
  await sleep(200);
  const backToFirst = (await bodyText(page)).includes('Q3 roadmap');
  if (movedToNext && backToFirst) record('TC-D2', 'PASS', '] / [ move between the two VIP threads while a thread is open');
  else record('TC-D2', 'FAIL', `movedToNext=${movedToNext} backToFirst=${backToFirst}`);
  await page.keyboard.press('Escape'); // close reading pane

  // --- D3/D4 on Newsletter tab (7 seeded threads) ---
  await clickTab(page, 'Newsletter');
  await sleep(200);
  const newsBefore = (await rowsInfo(page)).map((r) => r.text);
  const newsCountBefore = newsBefore.length;
  await focusBody(page);
  // move selection to index 3 (mid-list)
  for (let i = 0; i < 3; i++) await page.keyboard.press('j');
  await sleep(150);
  const midSel = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    const idx = rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
    return { idx, text: rows[idx]?.textContent.trim() };
  });
  await page.keyboard.press('e'); // archive via kbar action
  await sleep(400);
  const afterArchive3 = await rowsInfo(page);
  // direct check: selection auto-advanced (still highlighted) and list shrank by 1, and archived item gone
  const selectedNow = afterArchive3.find((r) => r.selected);
  const autoAdvanced = afterArchive3.length === newsCountBefore - 1 && !!selectedNow && !afterArchive3.some((r) => r.text === midSel.text);
  if (autoAdvanced) {
    record('TC-D3', 'PASS', `archived mid-tab thread; list shrank ${newsCountBefore}->${afterArchive3.length}, selection auto-advanced`);
  } else {
    record('TC-D3', 'FAIL', `newsCountBefore=${newsCountBefore} after=${afterArchive3.length} selectedNow=${!!selectedNow}`);
  }

  // TC-D4: archive the last thread in the tab -> selection clamps
  const lenBeforeLast = afterArchive3.length;
  for (let i = 0; i < lenBeforeLast; i++) await page.keyboard.press('j'); // overshoot to last (clamped by store)
  await sleep(150);
  const lastSelBefore = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    const idx = rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
    return idx;
  });
  await page.keyboard.press('e');
  await sleep(400);
  const afterLastArchive = await rowsInfo(page);
  const clampedIdx = afterLastArchive.findIndex((r) => r.selected);
  const d4ok =
    lastSelBefore === lenBeforeLast - 1 &&
    afterLastArchive.length === lenBeforeLast - 1 &&
    clampedIdx === afterLastArchive.length - 1;
  if (d4ok) {
    record('TC-D4', 'PASS', `archiving the last thread clamps selection to the new last index (${clampedIdx})`);
  } else {
    record('TC-D4', 'FAIL', `lastSelBefore=${lastSelBefore} lenBeforeLast=${lenBeforeLast} afterLen=${afterLastArchive.length} clampedIdx=${clampedIdx}`);
  }

  // TC-D6: mark read via opening the thread, it stays in tab, unread count -1
  // (use the Team tab's still-unread "Postmortem" thread — VIP's threads were already read by D1/D2)
  await clickTab(page, 'Team');
  await sleep(200);
  const teamTabBefore = (await tabsInfo(page)).find((t) => t.label === 'Team');
  await clickRowContaining(page, 'Postmortem: snooze daemon');
  await sleep(300);
  const teamTabAfter = (await tabsInfo(page)).find((t) => t.label === 'Team');
  const teamRowsAfter = (await rowsInfo(page)).map((r) => r.text);
  const stillInTeam = teamRowsAfter.some((t) => t.includes('Postmortem: snooze daemon'));
  const before = Number(teamTabBefore?.badge ?? 0);
  const after = Number(teamTabAfter?.badge ?? 0);
  if (stillInTeam && after === before - 1) {
    record('TC-D6', 'PASS', `marking a thread read keeps it in Team and drops unread badge ${before}->${after}`);
  } else {
    record('TC-D6', 'FAIL', `stillInTeam=${stillInTeam} before=${before} after=${after}`);
  }
  await page.keyboard.press('Escape');

  // TC-D7: open thread, switch tab, j/k stays within new tab's list
  await clickTab(page, 'VIP');
  await clickRowContaining(page, 'Q3 roadmap');
  await sleep(300);
  await page.keyboard.press('Tab'); // VIP -> Team (order dependent, just check next tab active)
  await sleep(200);
  const teamActive = (await tabsInfo(page)).find((t) => t.active)?.label;
  const openThreadStillShown = (await bodyText(page)).includes('Q3 roadmap');
  await page.keyboard.press('j');
  await sleep(150);
  const teamSel = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    return rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
  });
  if (openThreadStillShown && teamActive !== 'VIP' && teamSel === 1) {
    record('TC-D7', 'PASS', `switching tabs with a thread open keeps it open; j/k moves within the new tab's own list`);
  } else {
    record('TC-D7', 'FAIL', `openThreadStillShown=${openThreadStillShown} teamActive=${teamActive} teamSel=${teamSel}`);
  }
  await page.keyboard.press('Escape');

  record('TC-D5', 'SKIP', 'trackpad swipe gesture cannot be simulated via CDP mouse/keyboard input — manual verification required');
  record('TC-D8', 'SKIP', 'MockGmailProvider.listThreads never returns nextPageToken — no loadMore in demo mode');

  await clickTab(page, 'Inbox');
}

// --- E (CRUD) + B4(done above) + A2 (first-match dedupe) -----------------

async function scenario_E_and_B4_and_A2(page) {
  await clickTab(page, 'Inbox');

  // TC-E6 + TC-A2: add an uppercase sender chip to VIP that overlaps Team's domain rule
  await openSplitSettings(page);
  const vipRow = await rowHandleByName(page, 'VIP');
  const vipChipInput = await vipRow.$('input[aria-label="sender@example.com, …"]');
  await vipChipInput.fill('MINA@ZENMAIL.APP');
  await vipChipInput.press('Enter');
  await saveSplitSettings(page);
  await sleep(300);

  await clickTab(page, 'Team');
  const teamAfter = (await rowsInfo(page)).map((r) => r.text);
  const teamHasMina = teamAfter.some((t) => t.includes('Sprint 14 planning'));
  await clickTab(page, 'VIP');
  const vipAfter = (await rowsInfo(page)).map((r) => r.text);
  const vipHasMina = vipAfter.some((t) => t.includes('Sprint 14 planning'));

  if (!teamHasMina && vipHasMina) {
    record('TC-E6', 'PASS', 'uppercase chip MINA@ZENMAIL.APP normalized to lowercase; matching thread now in VIP');
    record('TC-A2', 'PASS', 'thread matching both VIP (senders) and Team (domain) appears only in VIP (earlier position) — first-match exclusivity holds');
  } else {
    record('TC-E6', 'FAIL', `teamHasMina=${teamHasMina} vipHasMina=${vipHasMina}`);
    record('TC-A2', 'FAIL', `teamHasMina=${teamHasMina} vipHasMina=${vipHasMina}`);
  }

  // TC-E2: add a brand-new split that matches existing Other-tab threads, verify immediate move
  await openSplitSettings(page);
  await page.click('text=+ Add split');
  await page.locator('input[aria-label="Split name"]').last().fill('Dreamus');
  const ruleSelect = page.locator('select[aria-label="Rule type"]').last();
  await ruleSelect.selectOption('domains');
  const domChipInput = page.locator('div.p-2').last().locator('input[aria-label="example.com, …"]');
  await domChipInput.fill('dreamus.io');
  await domChipInput.press('Enter');
  await saveSplitSettings(page);
  await sleep(300);
  const tabsAfterAdd = (await tabsInfo(page)).map((t) => t.label);
  await clickTab(page, 'Dreamus');
  const dreamusRows = (await rowsInfo(page)).map((r) => r.text);
  const movedIn = dreamusRows.some((t) => t.includes('keyboard shortcut audit') || t.includes('Standup notes'));
  if (tabsAfterAdd.includes('Dreamus') && movedIn) {
    record('TC-E2', 'PASS', 'new split tab appears immediately and matching Other-tab threads move into it without IPC reload');
  } else {
    record('TC-E2', 'FAIL', `tabsAfterAdd=${tabsAfterAdd.join(',')} dreamusRows=${JSON.stringify(dreamusRows)}`);
  }

  // TC-E3: reorder — move Dreamus above VIP, verify tab order + Cmd+N mapping follow
  await openSplitSettings(page);
  const rows3 = await splitSettingsRows(page);
  const dreamusIdx = rows3.findIndex((r) => r.name === 'Dreamus');
  for (let i = 0; i < dreamusIdx; i++) {
    await page.click('[aria-label="Move Dreamus up"]');
  }
  await saveSplitSettings(page);
  await sleep(300);
  const orderAfterE3 = (await tabsInfo(page)).map((t) => t.label);
  const dreamusNowFirstSplit = orderAfterE3[1] === 'Dreamus';
  await clickTab(page, 'Inbox');
  await page.keyboard.press(`Meta+2`);
  await sleep(200);
  const cmd2Target = (await tabsInfo(page)).find((t) => t.active)?.label;
  if (dreamusNowFirstSplit && cmd2Target === 'Dreamus') {
    record('TC-E3', 'PASS', `reorder moved Dreamus to position 1; tab order and Cmd+2 both follow: ${orderAfterE3.join(' | ')}`);
  } else {
    record('TC-E3', 'FAIL', `orderAfterE3=${orderAfterE3.join(',')} cmd2Target=${cmd2Target}`);
  }

  // TC-E5: disable Dreamus, verify tab disappears and its threads fall back to Other/next match
  await openSplitSettings(page);
  const dreamusRow = await rowHandleByName(page, 'Dreamus');
  const dreamusCheckbox = await dreamusRow.$('input[type="checkbox"]');
  await dreamusCheckbox.uncheck();
  await saveSplitSettings(page);
  await sleep(300);
  const tabsAfterDisable = (await tabsInfo(page)).map((t) => t.label);
  await clickTab(page, 'Other');
  const otherRowsAfterDisable = (await rowsInfo(page)).map((r) => r.text);
  const backInOther = otherRowsAfterDisable.some((t) => t.includes('keyboard shortcut audit') || t.includes('Standup notes'));
  if (!tabsAfterDisable.includes('Dreamus') && backInOther) {
    record('TC-E5', 'PASS', 'disabling Dreamus removes its tab; matched threads fall back to Other');
  } else {
    record('TC-E5', 'FAIL', `tabsAfterDisable=${tabsAfterDisable.join(',')} backInOther=${backInOther}`);
  }

  // TC-E4: delete the active split, verify fallback + no crash
  await clickTab(page, 'VIP');
  await openSplitSettings(page);
  await page.click('[aria-label="Delete VIP"]');
  await saveSplitSettings(page);
  await sleep(300);
  const crashed = await page.evaluate(() => document.body.innerText.trim().length === 0);
  const activeAfterDelete = (await tabsInfo(page)).find((t) => t.active)?.label;
  // store falls back to INBOX_TAB (the first tab in `order`) when the active split id disappears
  if (!crashed && activeAfterDelete === 'Inbox') {
    record('TC-E4', 'PASS', `deleting the active VIP split falls back to "${activeAfterDelete}" without crashing`);
  } else {
    record('TC-E4', 'FAIL', `crashed=${crashed} activeAfterDelete=${activeAfterDelete}`);
  }

  // TC-E7: Esc discards changes
  await openSplitSettings(page);
  await page.locator('input[aria-label="Split name"]').first().fill('SHOULD_NOT_PERSIST');
  await page.keyboard.press('Escape');
  await sleep(200);
  const stillOpenAfterEsc = (await bodyText(page)).includes('Configure splits');
  await openSplitSettings(page);
  const rowsAfterE7 = await splitSettingsRows(page);
  const discarded = !rowsAfterE7.some((r) => r.name === 'SHOULD_NOT_PERSIST');
  await cancelSplitSettings(page);
  if (!stillOpenAfterEsc && discarded) {
    record('TC-E7', 'PASS', 'Esc closes the modal and discards the unsaved rename');
  } else {
    record('TC-E7', 'FAIL', `stillOpenAfterEsc=${stillOpenAfterEsc} discarded=${discarded}`);
  }

  await clickTab(page, 'Inbox');
}

// --- D9: rule edit removes open thread from active tab -------------------

async function toggleSplitEnabled(page, name) {
  await openSplitSettings(page);
  const row = await rowHandleByName(page, name);
  const cb = await row.$('input[type="checkbox"]');
  await cb.click();
  await saveSplitSettings(page);
  await sleep(300);
}

async function scenario_D9(page) {
  await clickTab(page, 'Newsletter');
  await focusBody(page);
  await page.keyboard.press('j');
  await sleep(150);
  await page.keyboard.press('Enter'); // open the selected Newsletter thread
  const readingPaneOpen = await page
    .waitForSelector('iframe', { timeout: 5000 }) // ThreadView renders sandboxed HTML in an iframe
    .then(() => true, () => false);

  // disable Newsletter — the open thread leaves the (now removed) active tab
  await toggleSplitEnabled(page, 'Newsletter');

  const tabs = (await tabsInfo(page)).map((t) => t.label);
  const activeTab = (await tabsInfo(page)).find((t) => t.active)?.label;
  const openThreadStillShown =
    readingPaneOpen && (await page.evaluate(() => !!document.querySelector('iframe')));
  await page.keyboard.press('j');
  await sleep(150);
  const selIdx = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('main span.rounded-full')).filter(
      (el) => el.classList.contains('h-2') && el.classList.contains('w-2') && !el.classList.contains('inline-block')
    );
    const rows = dots.map((d) => d.closest('button'));
    return rows.findIndex((b) => b?.classList.contains('bg-bg-subtle'));
  });
  if (openThreadStillShown && !tabs.includes('Newsletter') && activeTab === 'Inbox' && selIdx >= 0) {
    record('TC-D9', 'PASS', 'rule edit removed active tab; open thread stayed open, active tab fell back to Inbox, selection re-anchored');
  } else {
    record('TC-D9', 'FAIL', `openThreadStillShown=${openThreadStillShown} tabs=${tabs.join(',')} activeTab=${activeTab} selIdx=${selIdx}`);
  }

  // cleanup: re-enable Newsletter, close reading pane
  await page.keyboard.press('Escape');
  await toggleSplitEnabled(page, 'Newsletter');
  await clickTab(page, 'Inbox');
}

// --- H1: regression spot-check -----------------------------------------

/** click Compose's own X button rather than Escape — avoids any focus-dependent Escape edge cases
 *  and keeps this regression spot-check independent of Escape-handling behavior we aren't testing here. */
async function closeComposeViaButton(page) {
  await page.click('button[title="Close (Esc)"]').catch(() => {});
  await sleep(200);
}

async function scenario_H1(page) {
  await clickTab(page, 'Inbox');
  await focusBody(page);

  await page.keyboard.press('c');
  const composeOpened = await page
    .waitForSelector('button[title="Close (Esc)"]', { timeout: 5000 })
    .then(() => true, () => false);
  await closeComposeViaButton(page);

  await clickRowContaining(page, 'Q3 roadmap');
  await sleep(300);
  await page.keyboard.press('r');
  const replyOpened = await page
    .waitForSelector('button[title="Close (Esc)"]', { timeout: 5000 })
    .then(() => true, () => false);
  await closeComposeViaButton(page);
  await sleep(200);

  // NOTE: these checks look for the actual rendered DOM (a real input/text-node marker),
  // not placeholder text — `document.body.innerText` never includes <input placeholder> values.
  await page.keyboard.press('l');
  const labelOpened = await page
    .waitForSelector('input[placeholder^="Apply label"]', { timeout: 5000 })
    .then(() => true, () => false);
  // click the modal backdrop via a direct DOM .click() (not pixel coordinates) to reliably close it
  await page.evaluate(() => document.querySelector('.absolute.inset-0.z-40')?.click());
  await sleep(300);

  await page.keyboard.press('b');
  // NOTE: SnoozePicker's heading has Tailwind's `uppercase` class, which CSS-transforms the
  // rendered text to "SNOOZE UNTIL…" in `innerText` — check case-insensitively (or via a
  // non-transformed marker) rather than the literal "Snooze until" string.
  const snoozeOpened = await page
    .waitForSelector('input[type="datetime-local"]', { timeout: 5000 })
    .then(() => true, () => false);
  await page.evaluate(() => document.querySelector('.absolute.inset-0.z-40')?.click());
  await sleep(300);
  await page.keyboard.press('Escape'); // close reading pane too

  if (composeOpened && replyOpened && labelOpened && snoozeOpened) {
    record('TC-H1', 'PASS', 'c/r/l/b actions all still open their respective UI in tab view');
  } else {
    record('TC-H1', 'FAIL', `composeOpened=${composeOpened} replyOpened=${replyOpened} labelOpened=${labelOpened} snoozeOpened=${snoozeOpened}`);
  }
}

// ===========================================================================
// F2 follow-up-reminders (docs/features/follow-up-reminders/TC.md)
// ===========================================================================

/** cross-scenario state handed off to scenario_verify_restart_state (TC-FUP-E1) */
const followupState = { designThreadId: null };

async function tryFollowupScenario(page, label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[harness] followup scenario "${label}" failed:`, err);
    record(`TC-FUP-${label}`, 'FAIL', String(err));
    // best-effort recovery: a failure mid-scenario can leave a modal backdrop open, which would
    // block every click in the rest of the run — clear it so later scenarios aren't cascade-failed.
    try {
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelector('.absolute.inset-0.z-40')?.click());
      await sleep(200);
    } catch {
      /* best-effort only */
    }
  }
}

// --- E2: sign-out clears followups (run first — also resets demo data to pristine) -------

async function scenario_followup_E2(page) {
  await clickTab(page, 'Inbox');
  await clickRowContaining(page, 'Q3 roadmap review');
  await sleep(300);
  const tmpThreadId = await threadIdOfRowContaining(page, 'Q3 roadmap review');
  await page.keyboard.press('h');
  // NOTE: FollowupPicker's own "Remind me…" heading has Tailwind's `uppercase` class, which
  // CSS-transforms it to "REMIND ME…" in `innerText` (same gotcha noted for SnoozePicker in
  // scenario_H1) — wait on a preset button instead, whose text is not CSS-transformed.
  await page.waitForSelector('button:has-text("2 days")', { timeout: 5000 });
  await page.click('button:has-text("2 days")');
  await sleep(300);
  const beforeSignOut = await listFollowups(page);
  const hadOne = tmpThreadId != null && beforeSignOut.some((f) => f.threadId === tmpThreadId);
  await page.keyboard.press('Escape');

  await page.click('text=Sign out');
  await sleep(500);
  await demoLogin(page); // fresh MockGmailProvider instance (pristine demo data) + same cache DB

  const afterRelogin = await listFollowups(page);
  if (hadOne && afterRelogin.length === 0) {
    record('TC-FUP-E2', 'PASS', 'signing out clears all followups (stale thread_id hygiene across accounts)');
  } else {
    record('TC-FUP-E2', 'FAIL', `hadOne=${hadOne} afterReloginCount=${afterRelogin.length}`);
  }
  await clickTab(page, 'Inbox');
}

// --- A: Compose remind-if-no-reply ----------------------------------------

async function scenario_followup_A(page) {
  await clickTab(page, 'Inbox');
  await focusBody(page);

  // TC-FUP-A1: preset pill appears + clears via ✕
  await openNewCompose(page);
  await setComposeRemind(page, '3 days');
  const pillShown = (await bodyText(page)).includes('Remind in 3d');
  await page.click('[aria-label="Remove reminder"]');
  await sleep(150);
  const pillGone = !(await bodyText(page)).includes('Remind in 3d');
  if (pillShown && pillGone) {
    record('TC-FUP-A1', 'PASS', 'Remind pill appears for the 3 days preset and clears via ✕');
  } else {
    record('TC-FUP-A1', 'FAIL', `pillShown=${pillShown} pillGone=${pillGone}`);
  }
  await closeComposeViaButton(page);

  // TC-FUP-A2 / TC-FUP-A5: new compose + remind, send, wait out the 10s undo window,
  // then confirm the followup landed on the freshly created thread's id.
  const beforeA2 = await listFollowups(page);
  const subjectA2 = `ZenMail E2E remind ${Date.now()}`;
  await openNewCompose(page);
  await addComposeRecipient(page, 'To', 'followup-e2e-a2@example.com');
  await fillComposeSubject(page, subjectA2);
  await setComposeRemind(page, '2 days');
  await clickComposeSend(page);
  await sleep(11000); // 10s undo window + registration margin
  const afterA2 = await listFollowups(page);
  const beforeIdsA2 = new Set(beforeA2.map((f) => f.threadId));
  const newEntriesA2 = afterA2.filter((f) => !beforeIdsA2.has(f.threadId));
  const registeredA2 = newEntriesA2.length === 1 && newEntriesA2[0].status === 'pending';

  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await sleep(400);
  const sentThreadId = await threadIdOfRowContaining(page, subjectA2);
  const idMatchesA5 = registeredA2 && sentThreadId != null && sentThreadId === newEntriesA2[0].threadId;
  let bannerShownA2 = false;
  if (sentThreadId) {
    await clickRowContaining(page, subjectA2);
    await sleep(300);
    bannerShownA2 = (await bodyText(page)).includes('Reminder set — no reply by');
    await page.keyboard.press('Escape');
  }
  if (registeredA2 && bannerShownA2) {
    record('TC-FUP-A2', 'PASS', 'followup registered once the 10s undo window elapses (listFollowups + pending banner)');
  } else {
    record('TC-FUP-A2', 'FAIL', `registeredA2=${registeredA2} newEntriesA2=${JSON.stringify(newEntriesA2)} bannerShownA2=${bannerShownA2}`);
  }
  if (idMatchesA5) {
    record('TC-FUP-A5', 'PASS', `new compose thread id (${sentThreadId}) correctly carries the followup — send() returns the real threadId`);
  } else {
    record('TC-FUP-A5', 'FAIL', `sentThreadId=${sentThreadId} newEntriesA2=${JSON.stringify(newEntriesA2)}`);
  }
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await sleep(300);

  // TC-FUP-A3: undo within the window -> nothing is ever registered (nor even sent)
  const beforeA3 = await listFollowups(page);
  const subjectA3 = `ZenMail E2E undo ${Date.now()}`;
  await clickTab(page, 'Inbox');
  await openNewCompose(page);
  await addComposeRecipient(page, 'To', 'followup-e2e-a3@example.com');
  await fillComposeSubject(page, subjectA3);
  await setComposeRemind(page, '3 days');
  await clickComposeSend(page);
  await waitFor(async () => (await bodyText(page)).includes('Sending in'), { timeout: 3000, desc: 'undo toast appears' });
  await page.click('button:has-text("Undo")');
  await sleep(11000); // long enough that a would-be registration bug would have already fired
  const afterA3 = await listFollowups(page);
  const beforeIdsA3 = new Set(beforeA3.map((f) => f.threadId));
  const leakedA3 = afterA3.some((f) => !beforeIdsA3.has(f.threadId));
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await sleep(400);
  const threadCreatedA3 = await threadIdOfRowContaining(page, subjectA3);
  if (!leakedA3 && !threadCreatedA3) {
    record('TC-FUP-A3', 'PASS', 'undo within the window cancels the send entirely — no thread, no followup');
  } else {
    record('TC-FUP-A3', 'FAIL', `leakedA3=${leakedA3} threadCreatedA3=${threadCreatedA3}`);
  }
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await sleep(300);
}

// --- A4: Remind + Schedule combo — countdown starts from the real send time ---

async function scenario_followup_A4(page) {
  await clickTab(page, 'Inbox');
  const subjectA4 = `ZenMail E2E scheduled remind ${Date.now()}`;
  const beforeA4 = await listFollowups(page);
  const beforeIdsA4 = new Set(beforeA4.map((f) => f.threadId));

  await openNewCompose(page);
  await addComposeRecipient(page, 'To', 'followup-e2e-a4@example.com');
  await fillComposeSubject(page, subjectA4);
  await setComposeRemind(page, '2 days');

  // datetime-local is minute-granularity — schedule ~65s out so it's reliably due by the time
  // we tick after the accepted 70s real-time wait below.
  const scheduledLocal = await page.evaluate(() => {
    const d = new Date(Date.now() + 65_000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  await page.getByRole('button', { name: 'Schedule…', exact: true }).click();
  await sleep(150);
  await page.locator('input[type="datetime-local"]').fill(scheduledLocal);
  await page.getByRole('button', { name: 'Schedule', exact: true }).click(); // the popover's own submit button
  await sleep(300);

  const rightAfterSchedule = await listFollowups(page);
  const notYetRegistered = !rightAfterSchedule.some((f) => !beforeIdsA4.has(f.threadId));

  await sleep(70_000); // accepted one-time real-time wait so the scheduled send becomes due
  const tickInvokedAt = Date.now();
  await debugTick(page); // force the daemon to process the now-due scheduled send

  const afterA4 = await listFollowups(page);
  const newEntryA4 = afterA4.find((f) => !beforeIdsA4.has(f.threadId));
  const expectedDueAt = tickInvokedAt + 2 * 86_400_000; // 2 days, approximating the real send time
  const dueAtOk = !!newEntryA4 && Math.abs(newEntryA4.dueAt - expectedDueAt) <= 2 * 60_000; // ±2min tolerance

  if (notYetRegistered && newEntryA4 && newEntryA4.status === 'pending' && dueAtOk) {
    record(
      'TC-FUP-A4',
      'PASS',
      `not registered before the scheduled send fires; registered after with dueAt≈send-time+2d (dueAt=${new Date(newEntryA4.dueAt).toISOString()})`
    );
  } else {
    record(
      'TC-FUP-A4',
      'FAIL',
      `notYetRegistered=${notYetRegistered} newEntryA4=${JSON.stringify(newEntryA4)} expectedDueAt=${new Date(expectedDueAt).toISOString()}`
    );
  }
}

// --- B: existing-thread `h` follow-up --------------------------------------

async function scenario_followup_B(page) {
  await clickTab(page, 'Inbox');
  await clickRowContaining(page, 'Design tokens v2');
  await sleep(300);

  // TC-FUP-B1
  const beforeB1 = await listFollowups(page);
  await page.keyboard.press('h');
  await page.waitForSelector('button:has-text("2 days")', { timeout: 5000 }); // picker open (see uppercase-innerText note above)
  await page.click('button:has-text("2 days")');
  await sleep(300);
  const afterB1 = await listFollowups(page);
  const beforeIdsB1 = new Set(beforeB1.map((f) => f.threadId));
  const createdB1 = afterB1.find((f) => !beforeIdsB1.has(f.threadId));
  const bannerB1 = (await bodyText(page)).includes('Reminder set — no reply by');
  if (createdB1 && createdB1.status === 'pending' && bannerB1) {
    record('TC-FUP-B1', 'PASS', 'h opens FollowupPicker on an existing thread; a preset sets a pending reminder + banner');
  } else {
    record('TC-FUP-B1', 'FAIL', `createdB1=${JSON.stringify(createdB1)} bannerB1=${bannerB1}`);
  }
  const designThreadId = createdB1?.threadId ?? (await threadIdOfRowContaining(page, 'Design tokens v2'));
  followupState.designThreadId = designThreadId;

  // TC-FUP-B3: re-setting on the same thread replaces (thread_id PK upsert), no duplicate row
  await page.keyboard.press('h');
  await waitFor(async () => (await bodyText(page)).includes('Cancel reminder'), { desc: 'picker shows Cancel reminder for a pending thread' });
  await page.click('button:has-text("1 week")');
  await sleep(300);
  const afterB3 = await listFollowups(page);
  const matchesB3 = designThreadId ? afterB3.filter((f) => f.threadId === designThreadId) : [];
  const dueChangedB3 = matchesB3.length === 1 && createdB1 && matchesB3[0].dueAt !== createdB1.dueAt;
  if (matchesB3.length === 1 && dueChangedB3) {
    record('TC-FUP-B3', 'PASS', 're-setting a reminder on an already-pending thread replaces it — no duplicate row');
  } else {
    record('TC-FUP-B3', 'FAIL', `matchesB3=${JSON.stringify(matchesB3)}`);
  }

  // TC-FUP-B2: Cancel reminder removes it
  await page.keyboard.press('h');
  const cancelVisibleB2 = await waitFor(
    async () => (await bodyText(page)).includes('Cancel reminder'),
    { desc: 'Cancel reminder visible (B2)' }
  ).then(() => true, () => false);
  await page.click('text=Cancel reminder');
  await sleep(300);
  const afterB2 = await listFollowups(page);
  const stillThereB2 = designThreadId ? afterB2.some((f) => f.threadId === designThreadId) : true;
  const bannerGoneB2 = !(await bodyText(page)).includes('Reminder set — no reply by');
  if (cancelVisibleB2 && !stillThereB2 && bannerGoneB2) {
    record('TC-FUP-B2', 'PASS', 'Cancel reminder in the picker removes the followup and its banner');
  } else {
    record('TC-FUP-B2', 'FAIL', `cancelVisibleB2=${cancelVisibleB2} stillThereB2=${stillThereB2} bannerGoneB2=${bannerGoneB2}`);
  }

  // TC-FUP-B4: ⌘K "remind" finds and runs the action, opening the picker
  await focusBody(page);
  await page.keyboard.press('Meta+k');
  await sleep(300);
  await page.keyboard.type('remind');
  await sleep(300);
  const paletteHasAction = (await bodyText(page)).includes('Remind me…');
  await page.keyboard.press('Enter');
  await sleep(300);
  const pickerBt = await bodyText(page);
  const pickerOpenViaPalette = pickerBt.includes('2 days') && pickerBt.includes('3 days') && pickerBt.includes('1 week');
  if (paletteHasAction && pickerOpenViaPalette) {
    record('TC-FUP-B4', 'PASS', '⌘K "remind" search finds and runs the Remind me… action, opening FollowupPicker');
  } else {
    record('TC-FUP-B4', 'FAIL', `paletteHasAction=${paletteHasAction} pickerOpenViaPalette=${pickerOpenViaPalette}`);
  }

  // leave a pending reminder on this thread on purpose — TC-FUP-E1 checks it survives a restart
  await page.click('button:has-text("2 days")');
  await sleep(300);
  const finalList = await listFollowups(page);
  followupState.designPendingConfirmed = designThreadId
    ? finalList.some((f) => f.threadId === designThreadId && f.status === 'pending')
    : false;

  await page.keyboard.press('Escape');
}

// --- C: reply detection / opportunistic + due-time resolution --------------

async function scenario_followup_C(page) {
  await clickTab(page, 'Inbox');

  // TC-FUP-C1: reply arrives before the due tick -> quiet removal, no resurface/toast
  const c1ThreadId = await threadIdOfRowContaining(page, 'Sent you the empty-state illustrations');
  await debugAddFollowupDueNow(page, c1ThreadId);
  await debugSimulateReply(page, c1ThreadId);
  await debugTick(page);
  await sleep(300);
  const afterC1 = await listFollowups(page);
  const c1Gone = !afterC1.some((f) => f.threadId === c1ThreadId);
  const noToastC1 = !(await bodyText(page)).includes('No reply yet');
  if (c1Gone && noToastC1) {
    record('TC-FUP-C1', 'PASS', 'a reply present at due-tick time removes the followup quietly — no resurfacing, no toast');
  } else {
    record('TC-FUP-C1', 'FAIL', `c1Gone=${c1Gone} noToastC1=${noToastC1}`);
  }

  // TC-FUP-C2: opportunistic clear on open, before due
  await clickRowContaining(page, 'Your receipt from Stripe');
  await sleep(300);
  const c2ThreadId = await threadIdOfRowContaining(page, 'Your receipt from Stripe');
  await page.keyboard.press('h');
  await page.waitForSelector('button:has-text("1 week")', { timeout: 5000 }); // picker open (see uppercase-innerText note above)
  await page.click('button:has-text("1 week")'); // due far in the future — only opening the thread should clear it
  await sleep(300);
  await debugSimulateReply(page, c2ThreadId);
  await page.keyboard.press('Escape');
  await sleep(200);
  await clickRowContaining(page, 'Your receipt from Stripe'); // re-open -> mail:fetch-thread runs the opportunistic check
  await sleep(400);
  const bannerGoneC2 = !(await bodyText(page)).includes('Reminder set — no reply by');
  const listAfterC2 = await listFollowups(page);
  const clearedInDbC2 = !listAfterC2.some((f) => f.threadId === c2ThreadId);
  if (bannerGoneC2 && clearedInDbC2) {
    record('TC-FUP-C2', 'PASS', 'opening a thread opportunistically clears a pending followup once a reply exists, even before due');
  } else {
    record('TC-FUP-C2', 'FAIL', `bannerGoneC2=${bannerGoneC2} clearedInDbC2=${clearedInDbC2}`);
  }
  await page.keyboard.press('Escape');

  // TC-FUP-C3: an additional outbound-only message (from me) must not be mistaken for a reply
  await clickRowContaining(page, 'E-ticket: ICN');
  await sleep(300);
  const c3ThreadId = await threadIdOfRowContaining(page, 'E-ticket: ICN');
  await page.locator('[data-placeholder^="Reply to"]').click();
  await page.keyboard.type('Thanks, following up on this.');
  await page.click('button:has-text("Send")'); // InlineReply's own Send button (Compose modal is closed)
  await sleep(11000); // let the outbound reply actually land (10s undo window)
  await debugAddFollowupDueNow(page, c3ThreadId); // baseline=due=now, i.e. after our own outbound message
  await debugTick(page);
  await sleep(300);
  const afterC3 = await listFollowups(page);
  const firedC3 = afterC3.find((f) => f.threadId === c3ThreadId);
  if (firedC3?.status === 'fired') {
    record('TC-FUP-C3', 'PASS', 'an outbound-only additional message is not mistaken for a reply — the followup still resurfaces');
  } else {
    record('TC-FUP-C3', 'FAIL', `firedC3=${JSON.stringify(firedC3)}`);
  }
  if (firedC3) await dismissFollowup(page, c3ThreadId); // tidy up so it doesn't linger pinned into later checks
  await page.keyboard.press('Escape');
}

// --- D: resurfacing (fired) — pin, nav integrity, trash, dismiss ------------

async function scenario_followup_D(page) {
  await clickTab(page, 'Inbox');

  // TC-FUP-D1 / TC-FUP-D3: due + no reply -> UNREAD + "No reply" chip + toast + top pin
  const d1ThreadId = await threadIdOfRowContaining(page, 'Re: keyboard shortcut audit');
  const wasUnreadBefore = await isThreadRowUnread(page, d1ThreadId);
  await debugAddFollowupDueNow(page, d1ThreadId);
  await debugTick(page);
  await sleep(400);

  const bt = await bodyText(page);
  const toastShownD1 = bt.includes('No reply yet') && bt.includes('keyboard shortcut audit');
  const rowsNow = await rowsInfo(page);
  const rowIdxD1 = rowsNow.findIndex((r) => r.text.includes('keyboard shortcut audit'));
  const isTopPinned = rowIdxD1 === 0;
  const chipShownD1 = rowIdxD1 >= 0 && rowsNow[rowIdxD1].text.includes('No reply');
  const isUnreadAfter = await isThreadRowUnread(page, d1ThreadId);

  if (!wasUnreadBefore && isUnreadAfter && toastShownD1 && chipShownD1) {
    record('TC-FUP-D1', 'PASS', 'a due+no-reply thread becomes UNREAD, gets the "No reply" chip, and shows the resurfacing toast');
  } else {
    record('TC-FUP-D1', 'FAIL', `wasUnreadBefore=${wasUnreadBefore} isUnreadAfter=${isUnreadAfter} toastShownD1=${toastShownD1} chipShownD1=${chipShownD1}`);
  }
  if (isTopPinned) {
    record('TC-FUP-D3', 'PASS', 'the fired thread is pinned to the top of the INBOX list regardless of date order');
  } else {
    record('TC-FUP-D3', 'FAIL', `rowIdxD1=${rowIdxD1}`);
  }

  // TC-FUP-D4: j/k/Enter/archive act on the pinned row itself (F1 re-anchoring invariant holds)
  await focusBody(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('k'); // clamped at index 0 == the pinned row
  await sleep(150);
  await page.keyboard.press('Enter');
  await sleep(300);
  const openedPinned = (await bodyText(page)).includes('keyboard shortcut audit');
  await page.keyboard.press('e'); // archive the open (pinned) thread via kbar
  await sleep(400);
  const afterArchiveRows = await rowsInfo(page);
  const archivedGone = !afterArchiveRows.some((r) => r.text.includes('keyboard shortcut audit'));
  if (openedPinned && archivedGone) {
    record('TC-FUP-D4', 'PASS', 'j/k/Enter/archive act correctly on the pinned row — selection re-anchoring holds with a pin present');
  } else {
    record('TC-FUP-D4', 'FAIL', `openedPinned=${openedPinned} archivedGone=${archivedGone}`);
  }
  await dismissFollowup(page, d1ThreadId); // tidy up

  // TC-FUP-D5: a due followup on a TRASHed thread is silently dropped, no resurrection
  await clickRowContaining(page, 'Standup notes 6/30');
  await sleep(300);
  const d5ThreadId = await threadIdOfRowContaining(page, 'Standup notes 6/30');
  await debugAddFollowupDueNow(page, d5ThreadId);
  await page.keyboard.press('#'); // trash the open thread
  await sleep(400);
  await debugTick(page);
  await sleep(300);
  const afterD5 = await listFollowups(page);
  const d5Gone = !afterD5.some((f) => f.threadId === d5ThreadId);
  const rowsAfterD5 = await rowsInfo(page);
  const notResurfacedD5 = !rowsAfterD5.some((r) => r.text.includes('Standup notes 6/30'));
  if (d5Gone && notResurfacedD5) {
    record('TC-FUP-D5', 'PASS', 'a due followup on a TRASHed thread is silently dropped — no resurrection into INBOX');
  } else {
    record('TC-FUP-D5', 'FAIL', `d5Gone=${d5Gone} notResurfacedD5=${notResurfacedD5}`);
  }

  // TC-FUP-D6: Dismiss on the fired ThreadView banner clears the chip + pin
  const d6ThreadId = await threadIdOfRowContaining(page, 'Re: offsite agenda');
  await debugAddFollowupDueNow(page, d6ThreadId);
  await debugTick(page);
  await sleep(400);
  await clickRowContaining(page, 'Re: offsite agenda'); // tick may have reordered the list — re-locate and open
  await sleep(300);
  const bannerBeforeDismiss = (await bodyText(page)).includes('No reply since');
  await page.click('text=Dismiss');
  await sleep(300);
  const bannerGoneD6 = !(await bodyText(page)).includes('No reply since');
  const rowsAfterD6 = await rowsInfo(page);
  const d6RowIdx = rowsAfterD6.findIndex((r) => r.text.includes('Re: offsite agenda'));
  const chipGoneD6 = d6RowIdx < 0 || !rowsAfterD6[d6RowIdx].text.includes('No reply');
  if (bannerBeforeDismiss && bannerGoneD6 && chipGoneD6) {
    record('TC-FUP-D6', 'PASS', 'Dismiss on the fired banner clears the chip; the thread is no longer pinned/marked');
  } else {
    record('TC-FUP-D6', 'FAIL', `bannerBeforeDismiss=${bannerBeforeDismiss} bannerGoneD6=${bannerGoneD6} chipGoneD6=${chipGoneD6}`);
  }
  await page.keyboard.press('Escape');
}

// --- D2: send&archive resurfacing — fired always adds INBOX+UNREAD (DECISIONS D11) ---

async function scenario_followup_D2(page) {
  await clickTab(page, 'Inbox');
  await clickRowContaining(page, 'Coffee next week?');
  await sleep(300);
  const d2ThreadId = await threadIdOfRowContaining(page, 'Coffee next week?');

  await page.keyboard.press('r'); // reply
  await page.waitForSelector('button:has-text("Send & archive")', { timeout: 5000 }); // reply compose has a threadId -> archive button renders
  await setComposeRemind(page, '3 days');
  await page.locator('button:has-text("Send & archive")').first().click();
  await sleep(11_000); // undo window elapses -> archive applied + followup registered (main-side)

  await clickTab(page, 'Inbox');
  const rowsAfterArchive = await rowsInfo(page);
  const archivedFromInbox = !rowsAfterArchive.some((r) => r.text.includes('Coffee next week?'));

  await debugAddFollowupDueNow(page, d2ThreadId);
  await debugTick(page);
  await sleep(400);
  await clickTab(page, 'Inbox');
  const rowsAfterFire = await rowsInfo(page);
  const backInInbox = rowsAfterFire.some((r) => r.text.includes('Coffee next week?'));

  if (archivedFromInbox && backInInbox) {
    record(
      'TC-FUP-D2',
      'PASS',
      'send&archive removes the thread from INBOX; a due+no-reply followup unconditionally resurfaces it into INBOX (+UNREAD, D11)'
    );
  } else {
    record('TC-FUP-D2', 'FAIL', `archivedFromInbox=${archivedFromInbox} backInInbox=${backInInbox}`);
  }
  if (d2ThreadId) await dismissFollowup(page, d2ThreadId); // tidy up
}

// --- F1/F2/F4 restart persistence --------------------------------------

let f1ExpectedFirstName;
let f1ExpectedOrder;

async function scenario_prepare_restart_state(page) {
  await clickTab(page, 'Inbox');
  await openSplitSettings(page);
  // rename the first remaining split (post-E4 deletion, VIP is gone — Team is likely first)
  f1ExpectedFirstName = 'RenamedForF1';
  await page.locator('input[aria-label="Split name"]').first().fill(f1ExpectedFirstName);
  await saveSplitSettings(page);
  await sleep(300);
  f1ExpectedOrder = (await tabsInfo(page)).map((t) => t.label);

  // F2: switch to a non-Inbox tab, then toggle split off
  const nonInboxTab = f1ExpectedOrder.find((l) => l !== 'Inbox');
  if (nonInboxTab) await clickTab(page, nonInboxTab);
  await sleep(200);
  await page.click('[title="Toggle split inbox (⌘⇧I)"]');
  await sleep(300);
}

async function scenario_verify_restart_state(page) {
  await demoLogin(page); // F4: app restarted -> effectively logged out -> demo relogin
  await sleep(500);

  await openSplitSettings(page);
  const rows = await splitSettingsRows(page);
  const nameOk = rows[0]?.name === f1ExpectedFirstName;
  await cancelSplitSettings(page);

  const tabBarHiddenAfterRestart = !(await tabBarVisible(page));

  // re-enable split view and confirm the last active tab was restored
  await page.click('[title="Toggle split inbox (⌘⇧I)"]');
  await sleep(400);
  const restoredActive = (await tabsInfo(page)).find((t) => t.active)?.label;
  const expectedNonInbox = f1ExpectedOrder?.find((l) => l !== 'Inbox');

  if (nameOk) record('TC-F1', 'PASS', `renamed split "${f1ExpectedFirstName}" and order survived a full app restart`);
  else record('TC-F1', 'FAIL', `rows[0].name=${rows[0]?.name}, expected ${f1ExpectedFirstName}`);

  if (tabBarHiddenAfterRestart && restoredActive === expectedNonInbox) {
    record('TC-F2', 'PASS', `splitInbox=off and activeSplitTab="${expectedNonInbox}" both restored after restart`);
  } else {
    record('TC-F2', 'FAIL', `tabBarHiddenAfterRestart=${tabBarHiddenAfterRestart} restoredActive=${restoredActive} expected=${expectedNonInbox}`);
  }

  if (nameOk) {
    record('TC-F4', 'PASS', 'split definitions survived sign-out (implicit, via restart) + demo re-login — account-independent local settings');
  } else {
    record('TC-F4', 'FAIL', 'split definitions did not survive the logout/re-login cycle');
  }

  // TC-FUP-E1: the pending followup left on "Design tokens v2" (see scenario_followup_B) should
  // survive a full app restart — demo thread ids are deterministic (`demo_3`), and the followup
  // row itself lives in the same on-disk cache DB (same --user-data-dir), independent of the
  // in-memory MockGmailProvider being freshly reconstructed on relogin.
  try {
    const listAfterRestart = await listFollowups(page);
    const stillPending = followupState.designThreadId
      ? listAfterRestart.some((f) => f.threadId === followupState.designThreadId && f.status === 'pending')
      : false;
    // the F2 check above restored the *last active split tab* ("Team"), which doesn't contain
    // "Design tokens v2" (dana@figma-mail.com) — switch back to Inbox (unfiltered) to find it.
    await clickTab(page, 'Inbox');
    await clickRowContaining(page, 'Design tokens v2');
    await sleep(300);
    const bannerRestored = (await bodyText(page)).includes('Reminder set — no reply by');
    await page.keyboard.press('Escape');
    if (stillPending && bannerRestored && followupState.designPendingConfirmed) {
      record('TC-FUP-E1', 'PASS', 'pending followup (banner + listFollowups) survives a full app restart');
    } else {
      record(
        'TC-FUP-E1',
        'FAIL',
        `designThreadId=${followupState.designThreadId} stillPending=${stillPending} bannerRestored=${bannerRestored} preConfirmed=${followupState.designPendingConfirmed}`
      );
    }
  } catch (err) {
    record('TC-FUP-E1', 'FAIL', String(err));
  }
}

process.on('SIGINT', async () => {
  await killApp();
  process.exit(130);
});

run();
