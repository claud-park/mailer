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

## D7. `mail:cancel-snooze`는 modifyThread 성공 확인 뒤에만 캐시 스누즈 행을 지운다 — 구현 중 발견·수정
- **컨텍스트**: 최초 구현은 `cache.removeSnooze(threadId)`를 `modifyThread` 호출 **전에** 실행했다. `modifyThread`(네트워크 호출)가 실패하면 스누즈 행은 이미 캐시에서 사라진 뒤라, 스누즈 데몬이 이 스레드를 다시는 깨울 방법이 없는데 서버엔 스누즈 라벨이 영구히 남는 상태가 된다.
- **선택**: 순서를 뒤집어 `modifyThread` 성공 이후에만 `removeSnooze`를 호출.
- **이유**: 실패 시 캐시의 스누즈 행이 그대로 남아있으면 데몬이 다음 tick에 다시 시도할 기회가 있다(자연 self-heal) — 반대 순서는 실패를 영구 고아 상태로 만든다. archiveThread/trashThread류의 "서버 호출 실패 시 로컬 롤백" 패턴과 동일한 원칙(로컬 상태 변경은 서버 확정 이후에, 또는 실패 시 되돌릴 수 있게)을 여기도 적용.

## D8. `applyLabel`/`applyLabelSelected`의 undo는 실제로 새로 추가된 스레드만 대상으로 한다 — 최종 전체 브랜치 리뷰 발견·수정
- **컨텍스트**: `applyLabel`의 낙관적 적용은 `!labelIds.includes(labelId)`일 때만 라벨을 추가한다(이미 그 라벨을 가진 스레드엔 no-op) — 그런데 최초 undo 구현은 이 조건 없이 무조건 `removeLabelId`+서버 remove를 수행했다. 벌크 라벨 적용(예: 10개 선택 후 "Work" 적용, 그중 2개는 이미 "Work"를 갖고 있었음)에서 Undo를 누르면, 원래부터 "Work"를 갖고 있던 2개에서도 라벨이 서버에서 영구 제거된다 — D7과 같은 "self-heal 불가능한 영구 손실" 클래스의 버그(D7은 방향이 반대: 로컬 추적 유실, 이건 서버 데이터 파괴).
- **선택**: 적용 시점에 `!includes(labelId)`로 "이번에 실제로 추가됐는지"를 캡처(단건은 boolean, 벌크는 `newlyAppliedIds` 배열로 필터)해, 이미 갖고 있던 스레드는 undo 대상에서 제외. 애초에 아무것도 새로 추가되지 않았다면(전부 이미 보유) undo 버튼 자체를 안 붙인다(제거할 게 없으므로).
- **이유**: undo는 "이 액션이 실제로 한 일"만 되돌려야 한다 — 이 액션이 손대지 않은 스레드의 기존 라벨 연결까지 건드리는 건 undo의 정의를 벗어난 부작용이다. 다른 3종(archive/trash/snooze)은 이미 `captureRemoval`로 "액션 직전 상태"를 스냅샷해 이 문제가 구조적으로 없었는데, applyLabel만 캡처 없이 구현된 것이 원인이었다.
- **검증**: 기존 happy-path E2E(TC-UNDO-A3, 매번 새 throwaway 라벨 사용)는 무영향(그 경로에선 항상 `alreadyHadLabel=false`이므로 undo가 여전히 정상 붙음) — 이번 수정으로 새로 생긴 회귀는 없음. pre-existing 라벨 케이스에 대한 전용 E2E는 이번 범위에 추가하지 않음(리뷰가 코드 추적만으로 확정한 버그라 vitest/코드 레벨 확신도가 이미 높음, E2E 하네스 확장은 후속 과제 후보로 남김).

## D9. Minor로 판정하고 수정하지 않은 항목 (최종 전체 브랜치 리뷰)
- **`restoreCapture`의 patch-in-place가 undo 창(5초) 동안의 동시 합법적 변경을 덮어쓸 수 있음**: 예를 들어 Starred 뷰에서 archive(행 잔류) 직후 5초 안에 백그라운드 revalidate가 그 스레드에 새 라벨을 얹었는데 그 사이 Undo를 누르면, capture 시점 라벨로 되돌아가며 그 변경분이 잠깐 사라진다. 다음 revalidate가 서버 진실로 자가 치유. 트리거 조건이 좁고(같은 5초 창 안에 같은 스레드가 외부에서 또 바뀌어야 함) 결과가 일시적이라 수정하지 않음.
- **undo의 보정 API 호출이 실패해도 로컬 낙관 복원을 되돌리지 않음**: "Undo failed" 토스트만 뜨고 로컬은 복원된 채로 남는데, 다음 revalidate가 서버 진실(여전히 archive/snooze 상태)로 재수렴시키며 스레드가 다시 사라지는 깜빡임이 생긴다. D7과 달리 self-heal 가능한 방향이라 best-effort로 수용.
- **`mail:cancel-snooze`가 캐시 행에 INBOX를 즉시 반영 안 함**(→ D8과 별개로 이미 수정 완료, 위 구현에 반영됨: `send&archive`와 동일하게 `applyLabelDelta(threadId, ['INBOX'], [snoozeLabel])` 추가).
