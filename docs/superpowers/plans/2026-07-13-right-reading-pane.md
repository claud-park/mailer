# right-reading-pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스레드 상세(ThreadView)를 리스트 하단(상하 40/60)에서 우측(좌우 40/60 고정 비율)으로 이동한다.

**Architecture:** `App.tsx`의 `main`(flex-col, Toolbar 상단)은 유지하고 Toolbar 아래에 flex-row 컨테이너를 신설. ThreadList는 fragment 반환이라 row 컨테이너에 직접 넣으면 배너/탭바가 가로로 흩어지므로, ThreadList 루트를 `<section>`(flex-col)으로 감싸고 폭 분기(w-2/5 ↔ flex-1)를 이 section이 소유한다. 좁아진 리스트를 위해 ThreadRow에 2줄 compact 변형을 추가하고 가상화 행 높이를 동적으로 전환한다.

**Tech Stack:** React 19, TypeScript, Tailwind v4, @tanstack/react-virtual, zustand.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-13-right-pane-and-light-mode-design.md` Feature A. 폭 배분 = **고정 비율 40/60**(사용자 확정), 리사이저 없음(YAGNI).
- **store/mail.ts 수정 금지** — j/k/Enter/Esc/[/] 내비게이션·`moveSelection`의 자동 리딩은 뷰 로직이 아니므로 무수정 동작해야 한다(무회귀 불변식).
- 신규 npm 의존성 금지.
- 검증 커맨드(전부 `zenmail/`에서): `npx tsc --noEmit` · `npm test` · E2E `node e2e/run-tc.mjs`.
- 커밋 메시지는 한국어, `feat(right-reading-pane): CPn — …` 형식. 각 Task 완료 시 커밋.

---

### Task 1: 레이아웃 골격 — 좌우 분할

**Files:**
- Modify: `zenmail/src/renderer/App.tsx:34-38`
- Modify: `zenmail/src/renderer/components/ThreadList.tsx:221-276` (return 블록)

**Interfaces:**
- Produces: ThreadList 루트 `<section>`이 폭 분기 소유(`activeThreadId ? 'w-2/5 …' : 'flex-1'`), ThreadView는 우측 잔여 폭(`flex-1 min-w-0` — ThreadView.tsx 230행 루트에 이미 `flex-1`이 있으므로 `min-w-0`만 추가).
- Consumes: `useMailStore((s) => s.activeThreadId)` (ThreadList에 이미 구독 존재, 179행).

- [ ] **Step 1: App.tsx — Toolbar 아래 flex-row 컨테이너**

`Shell`의 34-38행을 다음으로 교체:

```tsx
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            <ThreadList />
            {activeThreadId ? <ThreadView /> : null}
          </div>
        </main>
```

- [ ] **Step 2: ThreadList — fragment를 section 래퍼로 교체하고 폭 분기 이동**

return 블록(221-276행)의 `<>…</>`를 `<section>`으로 교체. 폭 분기는 section이, 스크롤 컨테이너는 `flex-1`로 단순화:

```tsx
  return (
    <section
      className={`flex min-h-0 flex-col ${
        activeThreadId ? 'w-2/5 shrink-0 border-r border-bg-border' : 'flex-1'
      }`}
    >
      <BulkActionBanner />
      {useSplit && <SplitTabBar />}
      {emptyState ? (
        …기존 그대로…
      ) : emptyTab ? (
        …기존 그대로…
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          …기존 가상화 내부 그대로…
        </div>
      )}
    </section>
  );
```

즉 242행의 `overflow-y-auto ${activeThreadId ? 'h-2/5 border-b border-bg-border' : 'flex-1'}`에서 조건 분기가 통째로 section으로 올라가고(`h-2/5 border-b` → `w-2/5 border-r`), 스크롤 div는 항상 `flex-1 overflow-y-auto`.

- [ ] **Step 3: ThreadView — 좁은 페인에서의 수축 안전장치**

`ThreadView.tsx:230`의 루트 `className="zen-fade-in flex min-h-0 flex-1 flex-col"`에 `min-w-0` 추가:

```tsx
    <div className="zen-fade-in flex min-h-0 min-w-0 flex-1 flex-col">
```

- [ ] **Step 4: typecheck + 수동 확인**

Run: `npx tsc --noEmit` PASS. `npm start` → Enter로 스레드 열면 우측에 상세, 리스트는 좌측 40% 유지, Esc로 닫으면 리스트 전체 폭 복귀. j/k로 이동 시 우측 페인이 따라 갱신되는지 확인.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/ThreadList.tsx src/renderer/components/ThreadView.tsx
git commit -m "feat(right-reading-pane): CP1 — 상하 분할을 좌우 40/60으로 (ThreadList section 래퍼가 폭 분기 소유)"
```

---

### Task 2: ThreadRow compact 2줄 변형 + 동적 행 높이

**Files:**
- Modify: `zenmail/src/renderer/components/ThreadList.tsx` — `ROW_HEIGHT`(10행), `ThreadRow`(37-166행), 가상화 설정(193-205행)

**Interfaces:**
- Produces: `ThreadRow`에 `compact: boolean` prop 추가. `COMPACT_ROW_HEIGHT = 64` 상수.
- Consumes: Task 1의 section 래퍼(폭 40% 상태에서만 compact).

- [ ] **Step 1: 상수와 동적 estimateSize**

```ts
const ROW_HEIGHT = 56;
const COMPACT_ROW_HEIGHT = 64;
```

`ThreadList` 본문에서(187행 근처):

```ts
  const compact = !!activeThreadId;
  const rowHeight = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
```

가상화 설정(193-198행)을 rowHeight 기반으로 바꾸고, 전환 시 재측정 effect 추가:

```ts
  const virtualizer = useVirtualizer({
    count: visibleThreads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // compact 전환 시 행 높이 재계산 — estimateSize 함수 교체만으로는 기존 측정값이 남는다
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);
```

infinite scroll 임계(212행)의 `ROW_HEIGHT * 4`는 그대로 둔다(근사치라 무해).

- [ ] **Step 2: ThreadRow에 compact prop 배선**

호출부(259-265행)에 `compact={compact}` 추가. `ThreadRow` props 타입에 `compact: boolean;` 추가.

- [ ] **Step 3: compact 레이아웃 구현**

`ThreadRow`의 return(100-165행)에서 button 내부를 compact 분기. **기존 1행 마크업은 문자 그대로 보존**하고, compact일 때만 2줄 구조를 렌더:

```tsx
  const dot = bulkSelected ? (
    <span className="flex h-2 w-2 shrink-0 items-center justify-center text-[11px] leading-none text-accent">
      ✓
    </span>
  ) : (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${thread.unread ? 'bg-accent' : 'bg-transparent'}`}
    />
  );

  if (compact) {
    return (
      <button
        onClick={/* 기존과 동일 */}
        onWheel={onWheel}
        data-thread-id={thread.id}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={`flex h-full w-full flex-col justify-center gap-0.5 border-b border-bg-border/60 px-4 text-left transition-transform ${
          bulkSelected ? 'bg-accent/10' : selected ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'
        }`}
      >
        <span className="flex w-full items-center gap-2">
          {dot}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${
              thread.unread ? 'font-medium text-text-primary' : 'text-text-secondary'
            }`}
          >
            {thread.from.name || thread.from.email}
            {thread.messageCount > 1 && (
              <span className="ml-1 text-[11px] text-text-muted">{thread.messageCount}</span>
            )}
          </span>
          {followup?.status === 'fired' && (
            <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              No reply
            </span>
          )}
          <span className="shrink-0 text-[11px] text-text-muted">{formatDate(thread.date)}</span>
        </span>
        <span className="flex w-full min-w-0 items-baseline gap-2 pl-4">
          <span
            className={`shrink-0 truncate text-[12px] ${
              thread.unread ? 'font-medium text-text-primary' : 'font-normal text-text-primary/80'
            }`}
            style={{ maxWidth: '60%' }}
          >
            {thread.subject}
          </span>
          <span className="truncate text-[11px] text-text-muted">{thread.snippet}</span>
        </span>
      </button>
    );
  }

  return (
    /* 기존 1행 마크업 그대로 — 단 unread 도트/체크 부분은 위에서 추출한 {dot}으로 치환 */
  );
```

compact에서 라벨 칩(`chips`)은 생략한다 — 40% 폭에서 2줄 밀도에 칩까지 넣으면 스니펫이 사라짐. 상세를 열고 있는 동안엔 우측 페인 헤더에 칩이 보이므로 정보 손실 없음(DECISIONS에 기록).

- [ ] **Step 4: typecheck + 수동 확인**

Run: `npx tsc --noEmit` PASS. `npm start` → 스레드 열면 리스트가 2줄 행(발신자+날짜 / 제목+스니펫)으로, 닫으면 기존 1행으로 복귀. 언리드 도트·bulk 체크·스와이프(가로 휠) 동작 유지 확인.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ThreadList.tsx
git commit -m "feat(right-reading-pane): CP2 — ThreadRow compact 2줄 변형 + 가상화 행 높이 동적 전환"
```

---

### Task 3: E2E — TC-RP 추가 + 전체 무회귀

**Files:**
- Modify: `zenmail/e2e/run-tc.mjs` (기존 TC 등록 패턴을 먼저 읽고 동일 구조로 추가)

**Interfaces:**
- Consumes: DOM 기하 — `getBoundingClientRect()`로 리스트/상세 페인 상대 위치·폭 검증. 리스트 section은 `data-thread-id` 행들의 조상, ThreadView는 `.zen-fade-in` 루트(필요시 안정 셀렉터로 `data-testid` 추가 가능 — 기존 하네스가 쓰는 셀렉터 관례를 따를 것).

- [ ] **Step 1: TC-RP 케이스 4건 추가**

- TC-RP-A1: 스레드 열림 시 ThreadView의 `rect.left`가 리스트 `rect.right` 이상(우측 배치)이고, 리스트 폭이 컨테이너의 36~44%.
- TC-RP-A2: 열림 시 행 높이가 `COMPACT_ROW_HEIGHT`(64) — 임의 행의 offsetHeight로 검증, 제목 텍스트가 발신자와 다른 줄(y 좌표 상이).
- TC-RP-A3: Esc로 닫으면 리스트가 전체 폭 복귀 + 행 높이 56.
- TC-RP-A4: 열림 상태에서 j 2회 → 우측 페인 제목이 선택 스레드를 따라 갱신(기존 자동 리딩 무회귀).

- [ ] **Step 2: 전체 E2E 실행 — 기하 의존 기존 TC 점검**

Run: `node e2e/run-tc.mjs`
Expected: TC-RP 4건 PASS + 기존 전 케이스 무회귀. 기존 TC 중 상하 분할 기하(높이/스크롤/가시성)에 의존해 깨지는 케이스가 있으면 **어서션만 새 기하에 맞게 수정**(동작 의미는 불변) 후 사유를 TC.md에 기록. 연속 2회 재실행 동일. `npm test && npx tsc --noEmit` PASS.

- [ ] **Step 3: TC.md 상태 갱신 + Commit**

```bash
git add e2e/run-tc.mjs ../docs/features/right-reading-pane/TC.md
git commit -m "feat(right-reading-pane): CP3 — E2E TC-RP 4건 + 전체 무회귀"
```
