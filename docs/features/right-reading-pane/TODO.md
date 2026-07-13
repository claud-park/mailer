# right-reading-pane — Checkpoint TODO

> Goal 2 산출물. tsc + npm test + E2E 무회귀 기준. 플랜: `docs/superpowers/plans/2026-07-13-right-reading-pane.md` Task 1~3 = CP1~CP3.
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 브레인스토밍(사용자 확정: 폭 배분 40/60 고정 비율) — `docs/superpowers/specs/2026-07-13-right-pane-and-light-mode-design.md` Feature A
- [x] 구현 플랜 작성 — `docs/superpowers/plans/2026-07-13-right-reading-pane.md`
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. 레이아웃 골격 — 좌우 분할 (Task 1)
- [x] `App.tsx` — Toolbar 아래 `flex min-h-0 flex-1` 컨테이너 신설, ThreadList·ThreadView를 그 안에 배치
- [x] `ThreadList.tsx` — return 블록의 fragment(`<>…</>`)를 `<section>` 래퍼로 교체하고 폭 분기(`activeThreadId ? 'w-2/5 shrink-0 border-r' : 'flex-1'`)를 section이 소유, 내부 스크롤 div는 `flex-1 overflow-y-auto`로 단순화
- [x] `ThreadView.tsx` — 루트 클래스에 `min-w-0` 추가(좁은 페인 수축 안전장치)
- [x] tsc + 수동 확인(Enter로 열면 우측 배치, Esc로 닫으면 리스트 전체 폭 복귀, j/k 갱신 확인)

## CP2. ThreadRow compact 2줄 변형 + 동적 행 높이 (Task 2)
- [x] `ThreadList.tsx` — `COMPACT_ROW_HEIGHT = 64` 상수 추가, `compact = !!activeThreadId`로 `rowHeight` 결정
- [x] 가상화 `estimateSize`를 `rowHeight` 기반으로 전환 + `useEffect`로 `virtualizer.measure()` 재측정(compact 전환 시)
- [x] `ThreadRow`에 `compact: boolean` prop 추가·배선, compact일 때 2줄 레이아웃(발신자+날짜 / 제목+스니펫, 라벨 칩 생략) 렌더 — 기존 1행 마크업은 그대로 보존
- [x] tsc + 수동 확인(열림 시 2줄, 닫힘 시 기존 1행, 언리드 도트·bulk 체크·스와이프 동작 유지)

## CP3. E2E — TC-RP 추가 + 전체 무회귀 (Task 3)
- [x] `e2e/run-tc.mjs` — TC-RP-A1~A4 케이스 4건 추가(기존 등록 패턴 준수)
- [x] 전체 E2E 실행 — 기하(상하 분할) 의존 기존 TC 점검, 깨지는 어서션은 의미 불변 수정 후 사유를 TC.md에 기록, 연속 2회 재실행 동일
- [x] `npm test && npx tsc --noEmit` PASS
- [x] TC.md 상태 갱신 → 커밋
