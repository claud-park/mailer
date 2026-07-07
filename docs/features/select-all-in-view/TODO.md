# select-all-in-view — Checkpoint TODO

> Goal 2 산출물. tsc + npm test + E2E 무회귀 기준.
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 브레인스토밍(사용자 무응답 → 추천안 채택, DECISIONS D1~D5 미확인 표기)
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. 순수 로직 + 스토어 상태
- [x] `store/mail.ts` — `bulkSelectedIds: Set<string>`(초기 empty) + `selectAllVisible()`(visibleThreads 전체 id 채움) + `clearBulkSelection()`
- [x] `archiveThread`/`trashThread`/`markRead`/`applyLabel`/`snoozeThread`에 `silent?: boolean` 옵션(기본 false) — true면 성공 토스트 생략
- [x] `archiveSelected()`/`trashSelected()`/`markReadSelected(read)`/`applyLabelSelected(labelId)`/`snoozeSelected(until)` — bulkSelectedIds 순회하며 silent 호출 → 집계 showToast → clearBulkSelection
- [x] tsc + npm test

## CP2. 단축키 배선 + 시각 표시
- [x] `useKeyboard.ts` — ⌘A(모디파이어 콤보이므로 useKeyboard 소유, isTyping 뒤·모달가드 뒤 배치) → selectAllVisible(). Escape가 bulk 모드면 clearBulkSelection 우선(액션 없음).
- [x] `CommandPalette.tsx` — e/#/I/U는 **kbar 소유 단일키**(CLAUDE.md 단축키 소유권 규약, useKeyboard 아님) — 해당 4개 액션의 `perform`에서 `useMailStore.getState().bulkSelectedIds.size > 0`면 archiveSelected()/trashSelected()/markReadSelected(true)/markReadSelected(false)를, 아니면 기존 단일 액션을 호출하도록 분기.
- [x] `ThreadRow.tsx` — `bulkSelectedIds.has(thread.id)` prop → 배경 `bg-accent/10` + 언리드 도트 자리 체크 아이콘
- [x] `components/BulkActionBanner.tsx`(신규) — 리스트 상단, "N selected — E archive · # trash · Esc cancel"
- [x] tsc + npm test

## CP3. 피커 bulk 분기
- [ ] `SnoozePicker.tsx` — bulk 모드면 onConfirm이 snoozeSelected(until) 호출
- [ ] `LabelPicker.tsx`(또는 동등 컴포넌트) — bulk 모드면 onConfirm이 applyLabelSelected(labelId) 호출
- [ ] tsc + npm test

## CP4. E2E + 마무리
- [ ] TC-SA-* (select-all 진입, 아카이브 일괄, 라벨/스누즈 일괄, 집계 토스트, Esc 취소, 타이핑 중 미발화, 모달 중 미발화)
- [ ] 기존 E2E 전체 무회귀 + 연속 2회 안정
- [ ] react-best-practices + web-design-guidelines + code-review low
- [ ] 커밋 → push, TODO/DEV_WORKFLOW 갱신
