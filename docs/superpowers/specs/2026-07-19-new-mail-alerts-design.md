# ZenMail — 새 메일 도착 알림 (배지 + 푸시) Design Spec

> 2026-07-19 · 브레인스토밍 산출물. 사용자 요청: "새로운 메일이 도착했을 때 app alert(badge + push alert) 기능 추가".
> 사용자 확정 6건(대화형 MCQ, 전부 권장안 채택): ① 배지·알림 범위 = **전체 계정 합산**(비활성 계정 포함), ② "새 메일" 판정 = **Inbox(+Starred) unread 증가**, ③ 알림 내용 = **발신자+제목 미리보기(1건) / 그룹화(2건+)**, ④ 클릭 동작 = **앱 포커스+해당 스레드 열기(1건, 필요시 계정 전환)** / **활성 계정 Inbox로 이동(그룹, 계정 자동전환 없음)**, ⑤ 앱이 이미 포커스 중이면 알림 **억제**(배지는 갱신), ⑥ v1은 **토글 없이 항상 ON**.
> feature slug: `new-mail-alerts` (DEV_WORKFLOW Goal 0~8 대상).
> 사전 조사(Explore agent): dock 배지·OS `Notification` 모두 기존 코드에 전무. 기존에 있는 건 계정별 `unreadCount`(사이드바 전용 in-app 배지, `snooze.ts` 60s 데몬 + `ipc.ts`의 로그인 직후 1회 `refreshBadges()`)뿐 — 이번 feature는 이 기존 배지 파이프라인을 확장하는 것이지 새 폴링 루프를 만드는 게 아니다.

## 목적

메일이 도착해도 ZenMail이 백그라운드에 있으면 사용자가 알 방법이 없다(사이드바 in-app 배지조차 앱을 열어야 보임). macOS Dock 배지(전체 계정 unread 합산)와 네이티브 데스크톱 알림(발신자/제목)을 추가해, 앱을 보고 있지 않을 때도 새 메일 도착을 인지할 수 있게 한다. 기존 60s 데몬 틱이 이미 계정별 unread count를 갱신하고 있으므로, 별도 폴링을 새로 만들지 않고 그 파이프라인을 확장한다(멀티 계정 D7 "실계정 API 비용 억제" 원칙 유지).

## 핵심 설계 — 어디에 무엇을 추가하나

### 1. `AccountContext`에 필드 1개 추가 (`src/main/ipc.ts:51-60`)

```ts
export interface AccountContext {
  // ...기존 필드 그대로...
  /** 마지막으로 관측한 "Inbox∪Starred, unread" 스레드 ID 집합. 아직 한 번도 못 가져왔으면 undefined
   *  (= 이 계정에 대한 첫 상세 조회 — baseline만 시딩하고 알림은 쏘지 않는다, 아래 §3). */
  lastKnownUnreadIds?: Set<string>;
}
```

`makeRealContext`/`makeReauthContext`/`makeDemoContext` 세 팩토리(114-154행)는 이 필드를 그냥 생략(undefined 기본값) — 새 필드라 초기화 코드 추가 불필요.

sign-out 시 `contexts.delete(email)`로 `AccountContext` 객체 자체가 버려지므로 `lastKnownUnreadIds`도 별도 정리 코드 없이 함께 GC된다(모듈 전역 Map을 새로 만들지 않고 기존 필드-온-컨텍스트 패턴을 따르는 이유).

### 2. `src/main/notify.ts` 신규 — 순수 로직 + 부수효과 분리

```ts
// 순수 함수(vitest 대상) — "새로 추가된 unread 스레드"만 골라내고 다음 baseline을 반환
export function diffNewUnread(
  current: ThreadSummary[],
  lastKnownIds: Set<string> | undefined
): { newThreads: ThreadSummary[]; nextIds: Set<string> } {
  const nextIds = new Set(current.map((t) => t.id));
  if (lastKnownIds === undefined) return { newThreads: [], nextIds }; // 첫 관측 = baseline만, 알림 없음
  const newThreads = current.filter((t) => !lastKnownIds.has(t.id));
  return { newThreads, nextIds };
}

// 부수효과 — OS Notification 발화(포커스 중이면 스킵) + 클릭 시 IPC 송신
export function fireNewMailNotification(
  perAccountNew: Array<{ accountId: string; threads: ThreadSummary[] }>,
  getWindow: () => BrowserWindow | null
): void { /* ... */ }

// 부수효과 — 전 계정 unreadCount 합산 → app.setBadgeCount
export function updateDockBadge(contexts: AccountContext[]): void { /* ... */ }
```

`diffNewUnread`는 계정 하나 분량 배열을 받는 순수 함수라 vitest로 바로 테스트 가능(첫 관측/증분/무변화 3케이스). `fireNewMailNotification`과 `updateDockBadge`는 Electron API(`Notification`, `app.setBadgeCount`)를 감싼 얇은 부수효과 레이어.

### 3. `src/main/snooze.ts`의 배지 루프(44-59행) 확장

현재: 계정마다 `inboxUnreadCount()`(라벨 메타데이터 1콜, 저렴) 호출 → 값이 바뀌면 `ctx.unreadCount` 갱신 + `pushAccounts()`.

확장: `n > ctx.unreadCount`(증가만, 감소/동일은 기존과 동일하게 카운트만 갱신)일 때만 **추가로** `provider.listThreads`를 1콜 더 호출해 현재 unread 스레드 목록(발신자/제목 포함)을 가져오고, `diffNewUnread(current, ctx.lastKnownUnreadIds)`로 진짜 신규분만 추출한다. `nextIds`를 `ctx.lastKnownUnreadIds`에 저장. 이 추가 콜은 "카운트가 늘었을 때만" 발생하므로 D7의 비용 원칙을 그대로 유지(매 틱 콜 아님).

이 쿼리는 Inbox 뷰의 `q`가 아니다 — `starred-view`가 이미 INBOX/STARRED를 분리했으므로(뷰 자체의 union 없음), "새 메일" 판정 전용으로 독립적인 union 쿼리를 쓴다:
- Real: `provider.listThreads({ q: 'is:unread (in:inbox OR is:starred) -in:trash -in:spam -label:zenmail/snoozed' })` — inbox-zero-starred가 한때 썼던 것과 같은 형태의 Gmail 쿼리(starred-view가 뷰 자체에서는 걷어냈지만 쿼리 패턴 자체는 검증된 형태).
- Mock: `isInInboxView(labelIds, snoozeLabelId) || isInStarredView(labelIds, snoozeLabelId)`(둘 다 `gmail.ts:16`에서 이미 export 중) `&& unread` 필터로 in-memory 계산.

전 계정 순회가 끝나면(기존 badge 루프 뒤) `updateDockBadge(getContexts())`로 dock 배지 갱신 + 이번 틱에 모인 계정별 `newThreads`를 모아 `fireNewMailNotification(...)` 1회 호출(계정 경계 없이 전역 합산 — 사용자 확정 ①).

### 4. `src/main/ipc.ts`의 `refreshBadges()`(266-282행)는 무변경

로그인/데모 진입 직후 카운트만 즉시 시딩하는 현재 동작을 그대로 유지 — **알림은 여기서 쏘지 않는다**(콜드스타트 시 기존 unread 전부가 "새 메일"로 오폭발하는 걸 막는 핵심 지점). 다만 dock 배지는 로그인 직후에도 바로 보여야 자연스러우므로 `updateDockBadge(getContexts())` 호출만 추가(알림 발화 로직과는 무관, 순수 카운트 합산).

`ctx.lastKnownUnreadIds`는 `refreshBadges()`에서 건드리지 않는다 — 데몬의 첫 "증가" 감지 시점에 `diffNewUnread`가 `lastKnownIds === undefined`를 보고 자동으로 baseline만 시딩(§2)하므로, 로그인 시점과 데몬 시점 두 곳에서 각각 콜드스타트를 챙길 필요 없이 한 곳(daemon)에서만 처리해도 안전하다.

### 5. 클릭 동작 — main→renderer IPC 1개 추가

`fireNewMailNotification`이 만든 `Notification`의 `on('click', ...)`에서:
- 신규 스레드 총합 1건: `getWindow()?.show(); getWindow()?.webContents.send('notify:activate', { accountId, threadId })`
- 2건 이상(그룹, 계정 무관 합산): `getWindow()?.show(); getWindow()?.webContents.send('notify:activate', { accountId: null, threadId: null })`

`src/main/preload.ts`에 기존 `onSnoozeFired`/`onFollowupFired`(86-94행)와 동일한 패턴으로 `onNotificationActivate` 추가, `src/shared/types.ts`의 `ZenmailApi`에 시그니처 등록:
```ts
onNotificationActivate(cb: (p: { accountId: string | null; threadId: string | null }) => void): () => void;
```

renderer 쪽(`src/renderer/hooks/useThreads.ts`, 기존 `onSnoozeFired` 구독과 나란히 배선): payload에 `accountId`가 있고 현재 `activeAccountId`와 다르면 `setActiveAccount(accountId)`(스토어에 이미 존재, `mail.ts:470-472`) 먼저 호출 후 `openThread(threadId)`(`mail.ts:172`, 이미 존재) — 그룹(둘 다 null)이면 계정 전환 없이 현재 활성 계정에서 Inbox 뷰로 이동만.

### 6. 포커스 중 억제

`fireNewMailNotification` 진입부에서 `getWindow()?.isFocused()`이면 `Notification` 생성 자체를 스킵(사용자 확정 ⑤) — `updateDockBadge`는 이 조건과 무관하게 항상 실행(배지는 포커스 여부와 무관하게 항상 최신).

### 7. E2E용 디버그 IPC — 기존 `--zenmail-e2e`(`ZENMAIL_E2E_PORT`) 게이트 패턴 그대로

`ipc.ts:780` 이하 기존 `mail:debug-external-archive`/`mail:debug-external-unstar`와 나란히:
```ts
ipcMain.handle('mail:debug-inject-new-mail', async (_e, accountId: string, opts?: { from?: string; subject?: string }) => {
  // MockGmailProvider 전용 — 지정 계정의 데모 데이터셋에 새 unread 스레드 1건을 추가(INBOX 라벨).
  // 실제 도착을 시뮬레이션할 뿐 다음 daemon tick(runDaemonTickNow, 기존 mail:debug-tick 재사용)이
  // 있어야 badge/notification 파이프라인이 이를 관측한다 — E2E는 inject 후 기존 debug-tick을 호출.
});
```
새 틱 트리거 IPC를 따로 만들 필요 없음 — 기존 `mail:debug-tick`(791행, `runDaemonTickNow` 호출)을 그대로 재사용.

## 상호작용 엣지 케이스

| 상황 | 동작 |
|---|---|
| 같은 60s 틱 안에서 계정 A는 +2, 계정 B는 +1 | 전역 합산 3건 → 그룹 알림 1개, dock 배지 = 전 계정 unreadCount 합 |
| unread count가 늘었다가(도착) 같은 틱에서 줄기도(다른 메일 읽음) 함 | 순감소면 `n > ctx.unreadCount` 게이트 자체가 안 열려 이번 틱은 그냥 카운트만 갱신, 신규분 알림 없음 — **알려진 한계**(60s 해상도 안에서 이미 기존 배지 시스템도 갖고 있던 동일한 블라인드 스폿, 이번 feature가 새로 만든 문제 아님. 다음 틱에 실제 순증이 있으면 정상 포착). 별도 대응 없음(YAGNI) |
| 계정이 처음 신호됨(로그인 직후 첫 daemon 틱에서 우연히 카운트가 또 늘어난 극히 좁은 레이스) | `ctx.lastKnownUnreadIds === undefined` → `diffNewUnread`가 baseline만 시딩, 알림 0건(§2) |
| 앱이 포커스 중일 때 도착 | 알림 스킵, 배지는 갱신(§6) |
| 앱이 아예 종료 상태 | 데몬 자체가 안 도는 기존 아키텍처 그대로 — 알림도 없음(기존 daemon 제약 상속, 새 제약 아님) |
| 읽음/보관/라벨만 변경(unread 순증 없음) | `diffNewUnread`가 newThreads=[] 반환 → 알림 없음 |
| 비서명(ad-hoc)·미공증 빌드에서 macOS 알림센터 동작 | 검증 필요(알려진 리스크로 문서화 — 이 feature 범위에서 고칠 수 있는 항목 아님, 코드사이닝/공증은 별개 배포 이슈) |

## 테스트 영향 (Goal 3에서 TC.md로 확정)

- TC-ALT-A: 단일 계정 1건 신규(`debug-inject-new-mail`+`debug-tick`) → dock 배지 증가, 알림 1건(발신자/제목), 클릭 시 해당 스레드 오픈.
- TC-ALT-B: 한 틱에 신규 2건 이상 → 그룹 알림 1개, 클릭 시 활성 계정 Inbox로만 이동(계정 전환 없음).
- TC-ALT-C: 비활성 계정에 신규 도착 → 배지는 전체 합산 반영, 알림도 발화, 클릭 시 필요하면 계정 전환 후 스레드 오픈(단건) / 그룹이면 전환 없음.
- TC-ALT-D: 창이 포커스 상태에서 도착 → 알림 없음, 배지는 갱신됨.
- TC-ALT-E: 로그인 직후 첫 틱(콜드스타트) → 알림 폭발 없음, 배지는 즉시(로그인 직후) 정확한 값 표시.
- TC-ALT-F: 읽음/보관 등 unread 비증가 변경 → 알림 없음.
- 순수 함수 `diffNewUnread`는 vitest 유닛 테스트로 3케이스(최초 관측/증분/무변화) 별도 커버 — E2E 없이도 핵심 로직 검증.

## 범위 밖 (YAGNI)

- 알림 on/off 토글, 사운드 설정 — v1은 항상 ON(사용자 확정 ⑥). 나중에 요청 시 `light-mode`의 설정-토글 패턴(kbar + settings KV) 그대로 재사용 가능.
- Gmail Pub/Sub 기반 실시간 push(초 단위 지연) — 별도 서버/웹훅 인프라 필요, 이 앱의 "백엔드 0" 아키텍처와 정면 충돌. 명시적으로 거부(대안 C, 위 대화 참고).
- 같은 틱 내 순증+순감소가 상쇄되는 경우의 정교한 이력 추적 — 60s 해상도 안에서 기존 배지 시스템도 갖고 있던 동일한 한계, 이번에 새로 풀지 않음.
- Windows/Linux 배지(오버레이 아이콘 등) — 이 프로젝트는 macOS DMG 전용 배포(다른 플랫폼 빌드 타깃 없음).
- 알림 그룹을 계정별로 분리해서 여러 개 띄우는 것 — 사용자 확정 ①에 따라 전역 합산 하나로 충분.
