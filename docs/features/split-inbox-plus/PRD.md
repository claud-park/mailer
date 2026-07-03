# F1 split-inbox-plus — Feature PRD

> 2026-07-03 · Goal 1 산출물. 설계 근거: deep-reasoner(Opus) 설계안 + [DECISIONS.md](DECISIONS.md).
> 상위 문서: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #3

## 1. 목적

받은편지함을 열 때의 스트레스를 구조적으로 제거한다(wow #3). 현재의 하드코딩된 Primary/Other 2분할을 **사용자 정의 가능한 우선순위 기반 스플릿 탭**으로 대체한다. VIP/팀/뉴스레터 메일이 자동 분리되어 "중요한 것만 보이는" 받은편지함을 만든다.

## 2. 범위

### In
- **스플릿 탭 바**: ThreadList 상단, 활성 스플릿 하나만 표시, 탭별 unread 카운트
- **기본 스플릿 3종**: VIP(수동 발신자 목록) · Team(도메인 매칭) · Newsletter(카테고리+발신자 휴리스틱) + 항상 존재하는 Other(catch-all)
- **커스텀 스플릿**: 추가/편집/삭제/순서변경 가능한 경량 설정 모달
- **키보드**: Tab/⇧Tab 탭 순환, ⌘1~9 직접 점프, ⌘⇧I 탭바 on/off(통합 리스트 토글), kbar 액션
- **영속화**: 스플릿 정의 + 뷰 상태(탭바 on/off, 마지막 활성 탭)를 SQLite에 저장
- **데모 데이터 보강**: 팀 도메인 클러스터·VIP 발신자 추가(스플릿 시연 가능하도록)

### Out
- Gmail 라벨/필터 생성(계정 상태 변경 없음 — [DECISIONS D2](DECISIONS.md))
- 규칙 조합(AND/OR) — 스키마만 확장 가능하게 열어둠
- AI 기반 자동 분류(스펙 §9 No AI)
- 스플릿별 알림 설정, 드래그앤드롭 정렬(버튼 정렬로 대체)

## 3. UX 스펙

### 3-1. 탭 바
- 위치: Toolbar 아래, 스레드 리스트 위. `activeLabelId === 'INBOX' && !searchQuery && splitInbox` 일 때만 표시.
- 구성: `[Inbox 44] [VIP 3] [Team 5] [Newsletter 24] [Other 12]` — **Inbox 탭이 맨 앞**(필터 없는 전체 로드분, 매칭 우선순위 비참여), 이어서 enabled 스플릿 position 순, 마지막에 Other 고정. 우측에 설정(gear) 버튼.
- 카운트: 로드된 스레드 기준 unread 수. `nextPageToken`이 남아 있으면 `N+` 표기(하한값 정직 표기).
- 활성 탭 강조, 클릭으로 전환. 탭 전환 시 리스트 최상단 선택(selectedIndex=0).
- 탭바 off(⌘⇧I) 시: 통합 단일 리스트(전체 INBOX). 기존 Toolbar "Split" 버튼도 동일 토글.

### 3-2. 스플릿 매칭 semantics
- **position 오름차순 first-match 배타 할당**: 한 스레드는 정확히 하나의 스플릿에만 속한다. 어떤 규칙에도 안 걸리면 Other.
- 근거: 탭 카운트 합 = 전체와 일치해야 "메일이 어디 갔지"가 없다. Superhuman 동일 모델.
- 규칙 타입 4종:
  - `senders`: 이메일 정확 매칭(소문자 정규화) — VIP 기본
  - `domains`: 발신자 도메인 매칭 — Team 기본(로그인 계정 도메인 자동 시드)
  - `labels`: 라벨/카테고리 ID 매칭 — 커스텀용
  - `newsletter`: CATEGORY_PROMOTIONS/UPDATES/FORUMS/SOCIAL 라벨 ∨ 발신자 `noreply|no-reply|newsletter|digest|updates@` 패턴
- 규칙당 단일 조건(v1). ThreadSummary에 List-Unsubscribe 헤더가 없으므로 뉴스레터 휴리스틱은 위 2가지로 제한.

### 3-3. 설정 모달 (SplitSettings)
- 진입: 탭바 gear 버튼, kbar "Configure splits…". 전용 단축키 없음(저빈도).
- 스플릿 행: 이름 · 규칙 타입 선택 · 값 입력(senders/domains=chip 입력, labels=라벨 선택, newsletter=값 없음) · enabled 토글 · 위/아래 정렬 버튼 · 삭제. 하단 "+ Add split".
- Other는 목록에 노출하되 편집/삭제/정렬 불가 표시.
- 로컬 편집 후 저장 시 replace-all 1회 커밋. Esc 닫기, keydown stopPropagation(기존 모달 패턴).

### 3-4. 키보드
| 키 | 동작 | 소유 |
|---|---|---|
| Tab / ⇧Tab | 다음/이전 탭 (리스트 포커스, 비타이핑·비모달 시에만 캡처) | useKeyboard |
| ⌘1~⌘9 | n번째 탭 직접 점프 (충돌 없음 확인됨) | useKeyboard |
| ⌘⇧I | 탭바(스플릿 뷰) on/off — 기존 의미 계승 | useKeyboard |
| — | "Next/Previous split", "Configure splits…" | kbar |

- Compose/검색 입력 중 Tab은 기본 포커스 이동 유지(폼 접근성).

### 3-5. Empty state
- 빈 스플릿 탭: 탭은 유지(카운트 0), 리스트에 탭 문맥 empty 메시지(예: "No VIP mail — you're all caught up").

## 4. 아키텍처

### 4-1. 데이터 모델 (`src/shared/types.ts`)
```ts
export type SplitRule =
  | { kind: 'senders'; emails: string[] }
  | { kind: 'domains'; domains: string[] }
  | { kind: 'labels'; labelIds: string[] }
  | { kind: 'newsletter' };

export interface SplitDefinition {
  id: string;
  name: string;
  position: number;   // 정렬 = 우선순위 = ⌘N 매핑
  enabled: boolean;
  rule: SplitRule;
}
```

### 4-2. 매칭 엔진 (`src/renderer/lib/splits.ts`, 순수 모듈)
```ts
computeSplits(threads, defs): { order: string[]; assignment: Map<threadId, splitId|'other'>; counts: Map<splitId, {total, unread}> }
// order = ['inbox', ...enabled splits by position, 'other']. 'inbox'는 필터 없음(counts는 전체 로드분).
selectVisibleThreads(threads, defs, activeSplitTab): ThreadSummary[]  // 원본 순서 보존 필터
```
- 1-pass O(N·R), 파생값은 store state에 캐시하지 않고 useMemo + store 메서드 내 동일 함수 호출(단일 소스). threads 변형 액션마다 재동기화 버그 방지.

### 4-3. 스토어 (`src/renderer/store/mail.ts`)
- 신규: `splitDefs`, `activeSplitTab`, `splitSettingsOpen`, `switchTab(id)`, `nextTab()/prevTab()`, `saveSplits(defs)`
- **selectedIndex 재정박**: 의미를 "threads 배열 인덱스" → "현재 visibleThreads 인덱스"로 변경. 소비처 6곳 전환: `targetThreadId`, `moveSelection`, `openThread`, `openSelected`, ThreadList selected 판정, swipe `findIndexOf`.
- index 기반 유지 이유: archive 후 같은 인덱스가 다음 보이는 스레드에 안착 — 현행 auto-advance 동작 무료 보존.
- `splitInbox` boolean은 폐기하지 않고 "탭바 표시" 마스터 토글로 재해석. `partitionThreads` 및 Primary/Other 헤더 로직 제거.
- 탭 전환 시 activeThread는 유지(Esc로 닫음), selectedIndex=0.

### 4-4. 영속화 (main process)
```sql
CREATE TABLE IF NOT EXISTS splits (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, rule TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```
- IPC 추가(`ZenmailApi` → ipc.ts → preload.ts 3곳 동기화):
  - `getSplits(): Promise<SplitDefinition[]>` — 비어 있으면 기본 3종 시드 후 반환
  - `setSplits(defs): Promise<void>` — replace-all
  - `getSetting(key) / setSetting(key, value)` — `splitInbox`, `activeSplitTab` 저장
- Team 기본 스플릿 도메인은 로그인 계정 이메일 도메인에서 파생(지연 시드).

### 4-5. 컴포넌트
- 신규: `SplitTabBar.tsx`(탭+카운트+gear), `SplitSettings.tsx`(모달, SnoozePicker 패턴)
- 수정: `ThreadList.tsx`(partition 헤더 제거 → visibleThreads 렌더), `useKeyboard.ts`(Tab/⇧Tab/⌘1-9 — ⌘메타 early-return 가드보다 위에 배치), `CommandPalette.tsx`(kbar 액션 3종), `Toolbar.tsx`(Split 버튼 유지)

## 5. 성공 기준 (Goal 7 게이트)

1. [TC.md](TC.md)의 전 케이스 E2E 통과
2. `npx tsc --noEmit` 통과
3. 데모 모드에서 기본 3종 스플릿이 시각적으로 시연 가능(팀 클러스터·VIP 데이터 포함)
4. 앱 재시작 후 스플릿 정의·뷰 상태 복원
5. 탭 전환·j/k·archive가 100ms 체감(로컬 연산만, IPC 왕복 없음)

## 6. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| 1 | selectedIndex 재정박 회귀 (6곳 분산, swipe/auto-advance/클램프) | 단일 순수함수 공유 + TC로 탭 내 j/k·archive advance·클램프 명시 검증 |
| 2 | Tab 캡처가 폼 접근성 파괴 | isTyping·모달 가드 후에만 캡처, TC로 Compose 내 Tab 검증 |
| 3 | 카운트 하한 혼란·Team 시드 오할당 | `N+` 표기, provider 이메일 기반 지연 시드, 데모 데이터 보강 |
