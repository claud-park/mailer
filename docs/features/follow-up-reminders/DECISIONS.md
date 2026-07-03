# follow-up-reminders — DECISIONS

> Goal 4 산출물. 결정이 뒤집히면 해당 항목을 갱신하고 영향 범위를 명시한다.
> 근거: docs/RESEARCH_SUPERHUMAN.md wow #4 — "지금 답 못 하면 나중에" + "상대가 N일 내 답 없으면 자동 리마인드". 헤비유저 최다 사용 기능.

## 제품 방향 (2026-07-03, 자율 진행 — ⚠️ 사용자 미확인 가정)

### D1. 범위: remind-if-no-reply(Compose 통합) + 기존 스레드 follow-up
- **결정**: (a) Compose 전송 시 "N일 내 답장 없으면 리마인드" 옵션(프리셋 2일/3일/1주 + 커스텀, 기본값 3일은 settings KV 저장), (b) 기존 스레드에 "Remind me…" 액션. 둘 다 스누즈 데몬(1분 틱)에 세 번째 due-체크로 처리.
- **이유**: DEV_WORKFLOW F2 정의("remind-if-no-reply, send & remind — 기존 snooze 데몬 인프라 재사용") 그대로. Superhuman에서 헤비유저 최다 사용으로 꼽힌 기능 조합.

### D2. 답장 도착 시 동작: 조용히 해제
- **결정**: due 이전이든 due 시점이든 답장이 확인되면 리마인드는 아무 UI 없이 해제된다(사용자가 이미 답장을 받았으므로 알릴 필요 없음).
- **이유**: "리마인드는 실패 경로의 안전망"이라는 기능 본질. 성공 경로에 노이즈를 더하지 않는 것이 미니멀 철학 부합.

### D3. 재부상 UX: INBOX 복귀 + 구분 마커 + toast
- **결정**: due 시 답장이 없으면 스레드를 INBOX로 복귀(아카이브된 경우)시키고 구분되는 마커와 toast로 알린다. 구체 메커니즘(unread화 여부, 마커 형태, 정렬 위치)은 설계 합성에서 확정.
- **이유**: 스누즈 복귀와 동일한 정신 모델 재사용, 단 "내가 기다리던 것"임을 구분해야 후속 액션(재촉 답장)으로 이어짐.

## 아키텍처 (설계 합성 후 추가)

## 아키텍처 (2026-07-03, deep-reasoner+Codex 합성 완료)

> 두 안은 스키마·send 시그니처·undo-후 등록·데몬 확장·due-시점 체크+기회적 해제·`h` 단축키·디버그 IPC E2E에서 **독립 수렴**. 갈린 축 판정은 D8~D10.

### D4. followups는 thread_id PK, pending|fired 2-상태
- **결정**: 스레드당 활성 followup 1개(PK upsert로 중복 자동 해소). 답장 감지·취소·Dismiss는 행 삭제, fired만 상태로 유지(재시작 시 마커/핀 복원의 진실원).
- **기각(Codex안)**: id PK + fired_at/cleared_at/source 이력 컬럼 — v1에 이력 소비자가 없음(YAGNI).

### D5. send()가 SendResult{threadId, messageId} 반환, SendReceipt 불변
- **결정**: GmailProvider.send 시그니처 변경(Real은 버리던 응답 반환, Mock은 내부 계산 반환). 렌더러용 SendReceipt는 그대로 — followup 등록이 전부 main-side라 렌더러가 threadId를 알 필요 없음.
- **이유**: 새 컴포즈+리마인드의 전제조건 갭(탐사에서 식별). 등록 지점은 정확히 2곳 — undo 타이머 콜백의 send 성공 직후(undo 시 자동 미등록), 데몬 예약전송 send 성공 직후(baseline=실발송시각).

### D6. 답장 판정: date>baseline && from≠내계정 (단순 규칙 고정)
- **결정**: cc-only 답장 포함, 내 추가 발신 미해당. **알려진 오탐 수용**: 자동응답/부재중/바운스는 답장으로 오판되어 조용히 해제됨. 알리아스 미모델링(내 알리아스 발신이 답장으로 오판 가능).
- **이유**: v1 프리미티브(getThread messages)로 가능한 최선의 단순 규칙. 정교화는 오탐 신고가 실재할 때.

### D7. 조기 해제는 fetch-thread 훅으로만 (폴링 없음)
- **결정**: due-시점 체크가 기본. 추가로 사용자가 스레드를 열 때 이미 가져온 detail을 재사용해 pending을 기회적으로 해제(추가 API 콜 0). threads-updated마다 전체 pending 체크는 기각(비용).
- **이유**: D2(조용한 해제)라 due 전 해제의 사용자 가시 효과는 pending 배너 소멸뿐 — 열람 시점 갱신으로 충분.

### D8. 재부상 = 마커+토스트+UNREAD + 최상단 핀(격리 CP)
- **결정**: fired 스레드를 INBOX 복귀(+UNREAD)시키고 **lib/splits 순수함수 레벨의 pinnedIds 파라미터**로 리스트 최상단 핀. 3중 미러(store/ThreadList/useKeyboard)가 동일 함수를 호출하므로 한 곳 수정으로 일관 적용, vitest+F1 전체 회귀 게이트.
- **경위**: deep-reasoner는 핀을 선택 CP로 격리(F1 재정박 리스크), Codex는 렌더러 정렬 핀 권장. 합성: 핀이 wow #4의 본질("다시 떠오르게")이므로 범위에 포함하되, 순수함수 한 지점+회귀 게이트로 리스크 통제.
- **기각**: client date bump(재fetch가 덮음 — 검증됨), 합성 메시지 주입(메일 semantics 오염).

### D9. 계정 스코핑 기각, signOut 시 정리
- **결정**: followups는 계정 무관 로컬(F1 D13과 일관). 대신 signOut에서 followups 정리(다른 계정 stale thread_id의 영구 재시도 방지).
- **참고**: snoozes/scheduled_sends도 같은 stale 이슈를 공유 — F6(sync-engine)에서 일괄 재검토 플래그.

### D10. E2E 결정론: 디버그 IPC 2종 (env 가드)
- **결정**: `__debugSimulateReply(threadId)`(mock에 인바운드 답장 주입)와 `__debugTick()`(데몬 틱 강제, 완료 await) — `ZENMAIL_E2E_PORT` 설정 && demo provider일 때만 등록. 60초 틱 대기·시간 조작 없이 결정론적 E2E.
- **이유**: run-tc.mjs는 DOM/CDP 전용이지만 window.zenmail(contextBridge)은 page.evaluate로 호출 가능(deep-reasoner 검증).
