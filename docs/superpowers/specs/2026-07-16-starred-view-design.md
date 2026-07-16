# ZenMail — Starred 전용 뷰 (Design Spec)

> 2026-07-16 · 브레인스토밍 산출물. 사용자 요청: "starred 는 따로 split inbox or category로 보이게 변경. default inbox should be zeroed out".
> 사용자 확정 4건: ① 배치 = **사이드바 시스템 항목**(Split Inbox 탭 아님 — splitInbox on/off와 무관하게 항상 접근 가능), ② Starred 범위 = **STARRED 라벨 전부 − Trash/Spam − 스누즈**, ③ Inbox 뷰 = **순수 INBOX 라벨로 복귀**(STARRED 유니온 제거 — archive된 starred는 더이상 Inbox에 없음), ④ 단축키 = **`g t`**(`g s`는 기존 "Go to sent" 유지).
> feature slug: `starred-view` (DEV_WORKFLOW Goal 0~8 대상).
> **선행 결정 supersede**: `docs/features/inbox-zero-starred/DECISIONS.md` D1/D2/D4/D7 — 당시 "인박스 뷰 = INBOX ∪ STARRED"로 archived-starred를 인박스에 편입시켰고 "사이드바 Starred 전용 뷰는 논스코프"라 명시했던 것을, 이번 세션에서 사용자가 정반대 방향(분리)으로 재확정. star 토글(`s`)·★ 인디케이터(D7 산출물)는 그대로 재사용.

## 목적

archived-but-starred 스레드가 Inbox 뷰에 영구 편입되면서 "Gmail 웹은 in:inbox=0인데 ZenMail Inbox는 안 비워짐" 문제가 재발하는 상황(사용자 리포트) — Inbox는 다시 순수 INBOX 라벨 멤버십으로 되돌리고, Starred는 Gmail의 STARRED 라벨을 그대로 반영하는 별도 시스템 뷰(사이드바 고정 항목)로 분리한다. 결과적으로 "Inbox=0이면 진짜 0"이 항상 성립하고, 별표는 archive 여부와 무관하게 항상 Starred에서 찾을 수 있다.

## 핵심 의미론 변경

### `src/shared/view.ts`

- `isInInboxView(labelIds, snoozeLabelId)` → `INBOX ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed`(STARRED 유니온 제거).
- 신규 `isInStarredView(labelIds, snoozeLabelId)` → `STARRED ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed`.
- `inLabelView(labelIds, viewLabel, snoozeLabelId)`: `viewLabel === 'INBOX'` → `isInInboxView`, `viewLabel === 'STARRED'` → `isInStarredView`, 그 외는 기존과 동일한 단순 `includes`.
- `viewMembershipLabels(viewLabel)`: `'INBOX'` → `['INBOX']`(유니온 제거로 단일 라벨), `'STARRED'` → `['STARRED']`. 둘 다 이제 단일 원소 배열이라 사실상 범용 `[viewLabel]` fallback으로 흡수 가능 — 별도 분기 불필요해짐(단순화 기회).

### `src/main/gmail.ts` — Real/Mock 두 provider 대칭 추가

- `RealGmailProvider.listThreads`: 기존 `isInboxView` 가드(단일 라벨 'INBOX' && !q) 옆에 `isStarredView` 가드(단일 라벨 'STARRED' && !q) 추가 → `q: 'is:starred -in:trash -in:spam -label:zenmail/snoozed'`(INBOX의 `in:inbox OR is:starred` 대신 `is:starred`만).
- `MockGmailProvider.listThreads`: 동일 가드 패턴, `isInStarredView`로 필터.
- 두 provider의 "단일 라벨 + !q" 가드 로직이 이미 중복돼 있었는데(D2 잔여 기술부채) 이번에 STARRED 분기까지 추가하면 3중 중복이 되므로, 작은 공용 헬퀄(`matchesSingleLabelView(req, label)`)로 추출해 정리한다(react-best-practices 대상은 아니지만 실효 중복 제거로 code-review에서 지적될 사안을 선제 정리).
- `MockGmailProvider`의 데모 시드 라벨 목록에 `STARRED` 시스템 라벨 항목이 없음(`listLabels`가 계산하는 unreadCount의 소스) → 시드에 `{ id: 'STARRED', name: 'Starred', type: 'system' }` 추가 필요(사이드바 배지용).
- 신규 디버그 훅 `externalUnstar(threadId)`(기존 `externalArchive`와 대칭, E2E의 STARRED SWR 수렴 테스트용) — mock 전용, real provider엔 불필요.

### `src/main/cache.ts`

- `getThreads`/`getViewRows`의 `label === 'INBOX'` SQL 분기(TRASH/SPAM 프리필터 직접 SQL, D11) 옆에 `label === 'STARRED'` 분기 추가: `WHERE label_ids LIKE '%"STARRED"%' AND NOT LIKE TRASH AND NOT LIKE SPAM AND NOT IN snoozes`(OR 없이 단일 라벨이라 INBOX 분기보다 단순). JS 필터는 `isInStarredView`로 미러.

### `src/main/ipc.ts`

무변경. SWR revalidate·`GRACE_MS`·`hasPendingMutations`·`viewMembershipLabels` 소비 경로가 이미 `viewLabel` 매개변수로 완전히 일반화돼 있어 STARRED가 그대로 올라탄다.

## 상호작용 의미론 (가장 버그 나기 쉬운 부분)

| 액션 | Inbox 뷰에서 | Starred 뷰에서 |
|---|---|---|
| Archive | 행 무조건 제거(더 이상 "starred면 유지" 없음) | 행 **유지**(archive는 INBOX만 벗기고 STARRED는 안 건드림 — Gmail 그대로) |
| Unstar | 행 유지(Inbox는 STARRED 무관) | STARRED 제거되는 순간 행도 제거 |
| Star | 뷰 변화 없음(라벨 추가는 뷰에서 빠지는 일이 없음) | 해당 없음(이미 starred) |

`src/renderer/store/mail.ts` 구현:
- `archiveThread`의 D5 "keepInPlace" 게이트(현재 `viewLabel === 'INBOX'`로 하드코딩) → `viewLabel === 'INBOX' || viewLabel === 'STARRED'`로 확장하고, 판정은 이미 쓰던 `inLabelView(nextLabels, viewLabel, snoozeLabelId)`를 그대로 재사용(로직 자체는 이미 일반적 — 게이트만 넓히면 됨).
- `toggleStar`의 unstar 분기: 현재 `keepInPlace = searchQuery || viewLabel !== 'INBOX' || inLabelView(nextLabels, 'INBOX', ...)`의 `viewLabel !== 'INBOX'` 단축 조건이 "INBOX가 아닌 모든 뷰는 무조건 유지"를 뜻해서 새 Starred 뷰에서 unstar해도 행이 안 사라지는 회귀를 만든다 — 단축 조건을 제거하고 `keepInPlace = searchQuery || inLabelView(nextLabels, viewLabel, snoozeLabelId)`로 통일한다. 다른 뷰(Sent/Drafts/커스텀 라벨)에서는 `nextLabels`가 그 라벨을 그대로 유지하므로 동작 무변화, STARRED 뷰에서만 올바르게 false로 떨어진다.
- `splitViewActive`/`pinnedFollowupIds`(Inbox 전용 게이트)는 변경하지 않음 — Starred는 스플릿 탭·팔로우업 핀 없는 flat 리스트(Sent/Drafts와 동격).

## UI

- `Sidebar.tsx`의 `SYSTEM_ITEMS`에 `{ id: 'STARRED', name: 'Starred' }`를 INBOX 다음, SENT 앞에 삽입. unread 배지는 INBOX와 동일한 패턴(`byId.get('STARRED')?.unreadCount`)으로 노출.
- kbar에 `{ id: 'starred', name: 'Go to starred', shortcut: ['g','t'], section: 'Navigation' }` 액션 추가(기존 `g i`/`g s`/`g d`/`g l`/`g c` 옆).
- 아이콘/글리프는 기존 라벨 dot 패턴 재사용 없이 텍스트만("Starred") — 별도 ★ 글리프 접두는 선택사항, 과하면 생략(간결함 우선).

## 테스트 영향 (범위가 가장 큰 부분)

`docs/features/inbox-zero-starred/`의 `TC-IZ-*`(9건)는 "Inbox = INBOX∪STARRED" 전제로 작성돼 지금 시맨틱과 어긋난다(예: TC-IZ-B2/B4 "archived-starred가 인박스에 남는다"는 이제 거짓). 이 세션에서:
- `TC-IZ-*` 어서션을 **폐기하지 않고** 새 시맨틱에 맞게 다시 씀(Inbox=순수 INBOX라는 걸 검증하는 형태로 전환 — "starred가 있어도 Inbox는 진짜 0으로 수렴한다"가 핵심 회귀 방지 포인트).
- 신규 `TC-STAR-*` 스위트: Starred 내비게이션+배지, archive-유지, unstar-제거, Trash/Spam/스누즈 배제, 외부 mutation(별표 해제) 수렴(`externalUnstar` 훅 사용).
- 전체 스위트 무회귀(캐논 SKIP 집합 재확인) 2회 연속 결정적.

## 범위 밖 (YAGNI)

- Starred 안에서의 Split 탭·커스텀 규칙 — Starred는 flat list.
- ★ 글리프를 사이드바 항목 자체에 붙이는 장식 — 텍스트 라벨로 충분.
- 계정별 Starred 설정(색상 등) — Gmail 표준 STARRED 라벨 그대로 사용, 커스터마이즈 없음.
