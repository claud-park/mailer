# label-crud — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 2번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 브레인스토밍(삭제 확인 다이얼로그) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [ ] **CP1 (main, fast-worker/Sonnet)**: `GmailProvider` 인터페이스에 `createLabel(name): Promise<Label>`/`deleteLabel(labelId): Promise<void>` 추가. `RealGmailProvider`는 `gmail.users.labels.create`/`labels.delete`(기존 `snoozeLabelId()`가 쓰는 API 재사용). `MockGmailProvider`는 in-memory `labels`/`threads` 반영(삭제 시 스레드 labelIds에서도 제거, D4). `src/shared/types.ts`에 `ZenmailApi.createLabel`/`deleteLabel` 추가, `ipc.ts`+`preload.ts` 배선.
- [ ] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬)**: `Sidebar.tsx` — "Labels" 헤더 옆 `+` 버튼+인라인 입력(생성), 라벨 행 hover 삭제 아이콘+확인 다이얼로그(기존 SnoozePicker류 모달 오버레이 패턴 재사용)+삭제 로직, `store/mail.ts`에 `createLabel(name)`/`deleteLabel(labelId)` 액션(낙관적 추가/제거+실패 롤백, 보고 있던 라벨 삭제 시 Inbox 복귀).
- [ ] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — `TC-LBL-*` 9건 신설.

## Goal 6~7: 검증
- [ ] (3건 통합) 최종 전체 브랜치 리뷰
- [ ] (3건 통합) `/react-best-practices`
- [ ] (3건 통합) `/code-review low`
- [ ] `npx tsc --noEmit` + `npm test` 클린
- [ ] E2E 전체 스위트 무회귀 ×2연속

## Goal 8: 마무리
- [ ] (3건 통합) DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] (3건 통합) 커밋·push
- [ ] (3건 통합) Obsidian ZenMail.md 체크포인트
