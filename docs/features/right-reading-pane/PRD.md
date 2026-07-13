# right-reading-pane — Feature PRD

> 2026-07-13 · Goal 1 산출물. `docs/superpowers/specs/2026-07-13-right-pane-and-light-mode-design.md` Feature A 브레인스토밍에서 사용자 확정.
> 상위: 사용자 요청 "mail detail을 bottom split → right split으로" (post-release, F1~F6 완료 후 두 개 독립 feature 중 하나 — 나머지는 `light-mode`)

## 1. 목적

스레드 상세(ThreadView)를 현재 리스트 하단(상하 40/60 분할)이 아니라 리스트 우측(좌우 분할, Superhuman/Mail.app 계열)에 배치한다. 상하 분할은 상세를 열면 리스트 가시 행 수가 40%로 줄고 본문 폭이 과도하게 넓어지는 반면, 좌우 분할은 리스트 컨텍스트를 유지하면서 본문을 읽기 적절한 폭으로 제한한다.

## 2. 범위

### In
- **레이아웃 전환**: 상세가 열린 상태(`activeThreadId` 존재)에서 리스트/상세 배치를 상하(`h-2/5`/`h-3/5` 상당)에서 좌우(`w-2/5`/`flex-1`)로 변경. 닫힘 시 리스트는 기존대로 컨테이너 전체 폭.
- **폭 배분**: 고정 비율 40/60(리스트 40% · 상세 60%) — 사용자가 2026-07-13 브레인스토밍에서 3옵션(고정 비율/드래그 리사이저/리스트 고정폭 컬럼) 중 직접 선택(D1).
- **레이아웃 소유권**: `ThreadList.tsx` 루트를 fragment에서 `<section>` 래퍼로 변경해 폭 분기(`w-2/5 shrink-0 border-r` ↔ `flex-1`)를 이 section이 소유(D2). `App.tsx`는 Toolbar 아래 `flex flex-row` 컨테이너만 신설, `ThreadView.tsx`는 우측 잔여 폭(`flex-1 min-w-0`)을 차지.
- **ThreadRow compact 변형**: 리스트 폭이 40%로 좁아지는 동안 기존 1행 마크업이 뭉개지므로, 상세가 열려 있을 때 2줄 레이아웃(1줄: 발신자+날짜, 2줄: 제목+스니펫)으로 전환. 라벨 칩은 compact 행에서 생략(D3). 닫힘 시 기존 1행 레이아웃 그대로 유지.
- **가상화 행 높이 동적 전환**: 1행(56px)/2행(64px) 전환에 맞춰 `@tanstack/react-virtual`의 `estimateSize`를 동적으로 바꾸고 `virtualizer.measure()`로 재측정(D4).

### Out (YAGNI, 브레인스토밍에서 기각)
- **드래그 가능한 리사이저**: 신규 컴포넌트 + 폭 persist 상태가 필요해 범위가 증가하므로 기각. 필요 시 후속 feature.
- **리스트 고정폭 컬럼**(예: 아바타/발신자만 남기는 좁은 컬럼 UI): 기존 ThreadRow의 정보 밀도(제목/스니펫/라벨)와 근본적으로 충돌해 기각.
- **`store/mail.ts` 수정**: j/k/Enter/Esc/[/] 내비게이션과 `moveSelection`의 자동 리딩은 전부 store 로직이며 순수 뷰(레이아웃) 변경이므로 무수정 불변식으로 둔다(D5).
- 신규 npm 의존성.

## 3. 성공 기준

1. 스레드를 열면 상세가 리스트 우측에 나타나고, 리스트는 컨테이너 폭의 약 40%, 상세는 약 60%를 차지한다.
2. 열림 상태에서 리스트 행은 2줄 compact 레이아웃(발신자+날짜 / 제목+스니펫)으로 표시되고, 닫으면 기존 1행 레이아웃으로 복귀한다.
3. j/k로 커서를 이동하면 우측 상세가 계속 선택된 스레드를 따라 갱신된다(자동 리딩 무회귀).
4. Esc로 상세를 닫으면 리스트가 전체 폭으로 복귀하고 행 높이도 56px로 되돌아온다.
5. 기존 E2E 전체 무회귀 + 신규 TC-RP 통과, tsc/vitest clean.

## 4. 아키텍처

```
App.tsx (Shell)
  main.flex-col
    Toolbar
    div.flex.min-h-0.flex-1   ← 신설: Toolbar 아래 flex-row 컨테이너
      ThreadList (section, 폭 분기 소유: activeThreadId ? w-2/5 : flex-1)
        BulkActionBanner / SplitTabBar / 가상화 리스트(flex-1 overflow-y-auto)
          ThreadRow(compact={!!activeThreadId})
      ThreadView (flex-1 min-w-0, activeThreadId 있을 때만 렌더)
```

변경 파일: `App.tsx`(flex-row 컨테이너 신설), `ThreadList.tsx`(fragment→section 래퍼가 폭 분기 소유, ROW_HEIGHT/COMPACT_ROW_HEIGHT 동적 전환, ThreadRow에 `compact` prop 배선), `ThreadView.tsx`(`min-w-0` 안전장치). 무변경: `store/mail.ts`, BulkActionBanner/Toolbar/가상화 로직 자체.
