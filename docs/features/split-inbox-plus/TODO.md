# F1 split-inbox-plus — Checkpoint TODO

> Goal 2 산출물. 각 체크포인트(CP)는 독립적으로 `npx tsc --noEmit` 통과 가능해야 한다.
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 컨텍스트 탐사 + 브레인스토밍 (deep-reasoner/Codex 병렬 설계)
- [x] PRD.md / DECISIONS.md 작성
- [ ] Codex 설계안 델타 대조·반영 (백그라운드 회수 중 — 구현 시작 전 게이트)
- [ ] TC.md 작성

## CP1. 모델·영속화 (UI 무변경)
- [ ] `shared/types.ts`: `SplitRule`/`SplitDefinition` 타입 + `ZenmailApi`에 getSplits/setSplits/getSetting/setSetting 추가
- [ ] `main/cache.ts`: splits/settings 테이블 DDL + CRUD 헬퍼
- [ ] `main/ipc.ts`: 핸들러 4종 + 기본 3종 시드(빈 테이블 시, Team=계정 도메인 지연 시드)
- [ ] `main/preload.ts`: expose
- [ ] tsc 통과

## CP2. 매칭 엔진 + 스토어 리팩터
- [ ] `renderer/lib/splits.ts`: `computeSplits` / `selectVisibleThreads` 순수함수
- [ ] store: `splitDefs`/`activeSplitTab`/`splitSettingsOpen` 상태, `switchTab`/`nextTab`/`prevTab`/`saveSplits` 액션, init에서 IPC 로드
- [ ] **selectedIndex 재정박** — 소비처 6곳 전환 (targetThreadId/moveSelection/openThread/openSelected/ThreadList 판정/swipe findIndexOf)
- [ ] `splitInbox` "탭바 표시" 재해석, `partitionThreads` 제거
- [ ] tsc 통과

## CP3. 탭 바 + ThreadList
- [ ] `SplitTabBar.tsx`: 탭+unread 카운트(`N+` 표기)+gear 버튼
- [ ] `ThreadList.tsx`: Primary/Other 헤더 제거 → visibleThreads 렌더, 탭 문맥 empty state
- [ ] 데모 데이터 보강: 팀 도메인 클러스터 3~4명 + VIP 발신자 (gmail.ts buildDemoData)
- [ ] tsc 통과 + 데모 모드 시각 확인

## CP4. 키보드
- [ ] `useKeyboard.ts`: Tab/⇧Tab(가드 후 캡처), ⌘1~9(메타 early-return 위 배치)
- [ ] `CommandPalette.tsx`: kbar 액션 3종 (Next/Previous split, Configure splits…)
- [ ] tsc 통과

## CP5. 설정 모달
- [ ] `SplitSettings.tsx`: 목록·행 편집(chip 입력/라벨 선택/토글/정렬/삭제)·Add split·replace-all 저장
- [ ] 진입점: 탭바 gear + kbar. Esc/stopPropagation 모달 패턴
- [ ] 활성 탭 삭제 시 폴백(switchTab(order[0] ?? 'other'))
- [ ] tsc 통과

## CP6. 영속화 마무리 + 폴리시
- [ ] `splitInbox`/`activeSplitTab` settings 저장·복원 (init 로드)
- [ ] selectedIndex 클램프(탭 마지막 스레드 archive 시)
- [ ] tsc 통과

## 게이트 (Goal 5~8)
- [ ] /react-best-practices 리뷰 반영
- [ ] impeccable audit pass (subagent)
- [ ] TC.md 전 케이스 E2E 통과
- [ ] /code-review low → 커밋 → main push
- [ ] Obsidian 체크포인트 (_obsidian/Projects/ZenMail.md + vault index 날짜)
