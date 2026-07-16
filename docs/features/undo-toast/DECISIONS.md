# undo-toast — DECISIONS

> 2026-07-16. D1~D2는 대화형 확정, D3~D6은 구현 세부 추천안.

## D1. Undo 대상 = Archive/Trash/Snooze/Label-apply 4종 전부 — 사용자 확정
- **선택지**: (a) 4종 전부, (b) Archive/Trash만.
- **선택**: (a).
- **이유**: 네 액션 모두 동일한 capture+rollback+보정 API 패턴이라 추가 비용이 거의 없고, Snooze/Label도 실수하기 쉬운 액션이라 제외할 이유가 약하다.

## D2. 라벨 삭제 확인 다이얼로그 필요 — 사용자 확정 (label-crud와 공유 결정이지만 undo-toast 범위엔 직접 영향 없음, 기록용)
- label-crud DECISIONS D1 참조.

## D3. 성공-후-undo는 로컬 롤백 + 서버 보정 호출 둘 다 필요 — 추천안
- **컨텍스트**: 기존 `rollbackRemoval`/`captureRemoval`은 "서버 호출이 실패해서 되돌리는" 용도라 서버가 실제로는 변경된 적이 없다 — 로컬 상태만 복원하면 끝. 그러나 undo는 서버가 **이미 성공적으로 변경된** 상태를 사용자 요청으로 되돌리는 것이라, 로컬 상태만 되돌리면 다음 revalidate에서 서버의 진짜(아카이브된) 상태가 다시 upsert되어 즉시 재-사라진다.
- **선택**: 로컬 낙관 복원과 동시에 반대 방향 `modifyLabels` 호출을 보낸다(archive undo → addLabelIds:['INBOX']).
- **이유**: 그 외에는 undo가 눈속임(잠깐 보였다가 다음 폴에 다시 사라짐)이 된다.

## D4. Undo 창 = 5초 — 추천안
- **선택지**: (a) 5초, (b) Send와 동일한 10초.
- **선택**: (a).
- **이유**: Archive/Trash/Snooze/Label은 Send보다 훨씬 빈번하게 발생하는 액션이라 토스트가 화면에 오래 머무르면 시각적 피로가 쌓인다 — Gmail 자체도 archive undo는 짧은 창(수 초)을 쓴다. Send는 "실수하면 상대에게 도달"이라는 더 무거운 리스크라 10초를 유지하는 게 맞고, 이번 4종은 그보다 가벼운 실수라 5초로 충분하다.

## D5. Snooze undo는 신규 IPC 필요 — 추천안
- **컨텍스트**: `cache.removeSnooze(threadId)`는 이미 존재하나 스누즈 데몬(main 내부)만 호출하고 IPC로 노출되지 않았다.
- **선택**: `mail:cancel-snooze` IPC 신설(캐시에서 스누즈 행 제거 + `modifyLabels`로 원래 라벨 복원을 원자적으로 수행).
- **이유**: renderer가 직접 cache를 건드릴 수 없으므로(IPC 경계) 새 진입점이 필요하다 — 기존 스누즈 IPC(`mail:snooze`)와 대칭되는 자연스러운 확장.

## D6. 벌크 undo는 단일 콜백으로 전건 복원 — 추천안
- **선택**: 벌크 액션의 capture 배열을 하나의 클로저에 담아 Undo 버튼 하나에 연결(개별 스레드별 undo 버튼 없음).
- **이유**: 벌크 액션 자체가 "여러 건을 하나의 의도로 처리"하는 것이므로 되돌릴 때도 하나의 의도(전체 복원)로 다루는 것이 일관적 — 부분 undo는 사용자가 요청한 적 없는 기능(YAGNI).
