# undo-toast — PRD

> 2026-07-16 · 오케스트레이터 도출 UX 개선 3건 중 1번. 브레인스토밍 설계 스펙: `docs/superpowers/specs/2026-07-16-ux-improvements-design.md`.

## 문제

Send에만 10초 undo(별도 `pendingSend`/`undoSend` 메커니즘)가 있고, Archive/Trash/Snooze/Label-apply는 성공 확인 토스트("Archived", "Moved to trash" 등)만 뜨고 되돌릴 방법이 없다. 키보드 중심 앱 특성상 빠르게 연타하다 실수로 잘못된 스레드를 아카이브/트래시/스누즈/라벨링해도 복구 수단이 실패-롤백(네트워크 오류 시에만 자동 발동) 외엔 전무하다.

## 요구사항

### R1. Archive/Trash/Snooze/Label-apply 4종에 Undo 버튼
- 각 액션 성공 토스트에 "Undo" 버튼이 붙는다(단건·벌크 모두).
- 5초 이내 클릭 시: 로컬 상태 복원(캡처된 이전 상태로) + 서버에도 되돌리는 보정 API 호출(archive→INBOX 재부여, trash→INBOX 재부여+TRASH 제거, label→그 라벨만 제거, snooze→스누즈 취소+원래 라벨 복원).
- 5초 경과 시 토스트가 사라지고 그 상태로 영구 확정(추가 조치 없음).
- 벌크 액션(archiveSelected 등)도 집계 토스트에 undo 하나로 전체 복원.

### R2. 실패 시 기존 동작과 공존
- undo와 무관하게, 서버 API 자체가 실패하면 기존 실패-롤백(자동, 토스트 "... failed — restored")이 그대로 동작한다 — undo는 "성공 이후 사용자가 마음을 바꾼 경우"만 다룬다.

## 논스코프
- Star/Unstar에 undo 버튼 — 이미 동일 키(`s`)로 즉시 원복 가능해 실효성 낮음.
- 여러 토스트 동시 표시(큐) — 단일 슬롯 유지, 최신이 이전 것을 대체.
- Undo 자체에 대한 재-undo(redo) — YAGNI.

## 성공 기준
- 데모: 아카이브/트래시/스누즈/라벨적용 각각 실행 직후 Undo 클릭 → 스레드가 원래 상태(원래 라벨·원래 뷰 위치)로 정확히 복원됨을 확인.
- 5초 경과 후에는 Undo 버튼이 사라지고 상태가 영구 확정됨을 확인.
- E2E `TC-UNDO-*` 전건 PASS + 전체 스위트 무회귀.
