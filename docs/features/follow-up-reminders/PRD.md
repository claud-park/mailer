# F2 follow-up-reminders — Feature PRD

> 2026-07-03 · Goal 1 산출물. 설계: deep-reasoner(Opus)+Codex 독립 병렬 → 합성([DECISIONS.md](DECISIONS.md) D4~).
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #4

## 1. 목적

Inbox-zero를 시스템으로: "상대가 N일 내 답장 없으면 자동으로 다시 떠오르게". 할 일 앱 없이 이메일만으로 후속 조치가 완결된다. 기존 스누즈 데몬(1분 틱) 인프라를 재사용한다.

## 2. 범위

### In
- **remind-if-no-reply (Compose)**: 전송 시 "N일 내 답장 없으면 리마인드" 옵션 — 프리셋 2d/3d/1w + 커스텀(일 수), 기본값 settings KV(`followupDefaultDays`, 초기 3)
- **기존 스레드 follow-up**: `h` 단축키(kbar) → FollowupPicker 모달
- **답장 감지·해제**: due 시점 판정 + 스레드 열람 시 기회적(opportunistic) 조기 해제. 답장 오면 조용히 해제(D2)
- **재부상**: due에 답장 없으면 INBOX 복귀(아카이브됐던 경우)+UNREAD+fired 마커+toast, **INBOX 리스트 최상단 핀**(격리 CP)
- **마커**: ThreadView 배너(pending: 취소 가능 / fired: Dismiss), ThreadList fired 칩
- **undo/예약전송 조합**: undo되면 미등록, 예약전송은 실제 발송 후 카운트다운 시작
- **데모/E2E**: mock 인바운드 답장 시뮬레이션 + 데몬 강제 틱(디버그 IPC, `ZENMAIL_E2E_PORT` 가드)

### Out
- Gmail 라벨/서버 상태로 followup 표현(로컬 전용 — F1 D2와 동일 철학)
- 알리아스 인식, 자동응답/바운스 필터링(v1 수용 — D6), AI 문구 제안(No AI)

## 3. UX 스펙

### 3-1. Compose
- 푸터의 Schedule popover 옆에 **Remind popover**(동일 인라인 popover 패턴): `2 days / 3 days / 1 week / Custom(일 수 input)`
- 설정 시 푸터에 pill: `Remind in 3d ✕`(✕로 해제). Schedule과 독립 조합 가능
- 전송 toast는 기존 그대로(등록 확인은 pill로 이미 표시)

### 3-2. 기존 스레드
- `h`(kbar 액션 "Remind me…", 충돌 없음 검증) → **FollowupPicker 모달**(SnoozePicker 셸 복제, 프리셋 상수는 Compose popover와 공유)
- 이미 pending인 스레드에서 h → picker에 "Cancel reminder" 노출

### 3-3. 답장/재부상 semantics
- **답장 기준**: `msg.date > baseline_at && msg.from.email ≠ 내 계정`(소문자 비교). cc-only 답장 포함, 내 추가 발신은 미해당
- **baseline**: 새 전송 = 실제 발송 완료 시각(undo 10초·예약 지연 반영), 기존 스레드 = 등록 시각
- **due & 답장 있음** → 행 삭제, UI 무반응(D2)
- **due & 답장 없음** → `fired`: INBOX(archived였으면 복원)+UNREAD 추가, `mail:followup-fired` → toast `No reply yet — "<subject>" is back`, ThreadList 상단 핀 + fired 칩
- **fired 해제**: ThreadView 배너 Dismiss, 또는 답장/아카이브 액션 시
- **TRASH/404** → 조용히 행 삭제

### 3-4. 마커
- ThreadList: fired만 칩(`No reply`) — pending은 리스트 밀도 보호를 위해 비표시
- ThreadView 헤더 배너: pending `Reminder set — no reply by <date> [✕]` / fired `No reply since <date> [Dismiss]`

## 4. 아키텍처

### 4-1. 스키마 (cache.ts, CREATE TABLE IF NOT EXISTS 관례)
```sql
CREATE TABLE IF NOT EXISTS followups (
  thread_id   TEXT PRIMARY KEY,            -- 활성 1개/스레드, upsert로 중복 해소
  baseline_at INTEGER NOT NULL,
  due_at      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | fired
  archived    INTEGER NOT NULL DEFAULT 0,  -- send&archive였는지 (재부상 시 INBOX 복원)
  created_at  INTEGER NOT NULL
);
```
CRUD: `addFollowup / dueFollowups(now) / setFollowupFired / removeFollowup / listFollowups`

### 4-2. send() 시그니처 변경 (전제조건 갭 해소)
```ts
export interface SendResult { threadId: string; messageId: string; }
GmailProvider.send(req): Promise<SendResult>   // Real: res.data.{threadId,id} 반환 / Mock: 내부 계산값 반환
```
- `SendRequest.remindDays?: number` 추가. **SendReceipt는 불변** — followup 등록은 전부 main-side, 렌더러는 threadId 불필요
- **등록 지점 정확히 2곳**: ① ipc.ts undo 타이머 콜백에서 `await p.send()` 성공 직후(undo 시 콜백 미실행 → 자동 미등록), ② 데몬 dueScheduledSends에서 send 성공 직후(baseline=실발송시각)

### 4-3. 데몬 확장 (snooze.ts tick 세 번째 루프)
- `dueFollowups(now)` → `getThread`로 답장 체크(due당 1콜, 희소) → 답장: removeFollowup / 무답장: modifyThread(+INBOX?/+UNREAD) + setFollowupFired + `mail:followup-fired` + `mail:threads-updated`. TRASH → remove. 실패 → 로그 후 행 유지(다음 틱 재시도)
- `tick`을 `runDaemonTickNow()`로 export(E2E 강제 틱)

### 4-4. 조기 해제 (추가 API 콜 0)
- `mail:fetch-thread` 핸들러에서 이미 가져온 detail로 해당 스레드의 pending followup 답장 검사 → 있으면 조용히 삭제. threads-updated마다 전체 체크는 기각(비용)

### 4-5. 최상단 핀 (격리 — lib/splits 순수 함수 레벨)
- `selectVisibleThreads`에 `pinnedIds?: Set<string>` 파라미터(fired followup thread ids) → 핀 먼저(자체 date순), 나머지 date순. **3중 미러(store/ThreadList/useKeyboard)가 같은 함수를 쓰므로 한 곳 수정으로 일관** — selectedIndex 재정박 불변식 유지, vitest로 고정
- INBOX 뷰(Inbox 탭 포함 모든 탭)에서만 적용

### 4-6. IPC 추가 (ZenmailApi)
`addFollowup(threadId, remindDays)`, `cancelFollowup(threadId)`, `dismissFollowup(threadId)`(fired 행 삭제), `listFollowups()`, `onFollowupFired(cb)` + 디버그(`ZENMAIL_E2E_PORT` && demo 가드): `__debugSimulateReply(threadId)`, `__debugTick()`(완료 await)

### 4-7. 스토어/컴포넌트
- store: `followups: Map<threadId, {status, dueAt}>`(init·threads-updated 시 listFollowups 동기화), `openFollowupPicker/scheduleFollowup/cancelFollowup/dismissFollowup`, onFollowupFired → toast
- 신규: `FollowupPicker.tsx`(모달), Compose 푸터 Remind popover. 수정: ThreadView(배너), ThreadList(fired 칩), CommandPalette(`h`), signOut 시 followups 정리

## 5. 성공 기준 (Goal 7)
1. [TC.md](TC.md) 전 케이스 E2E 통과(run-tc.mjs 확장) + 기존 F1 TC 회귀 그린
2. tsc 0 에러, vitest(splits 핀 케이스 포함) 통과
3. 데모 모드에서 시연: 리마인드 설정 → 강제 틱 → 재부상(핀+칩+toast) / 답장 시뮬 → 조용한 해제
4. undo한 전송은 리마인드 미등록

## 6. 리스크
| # | 리스크 | 완화 |
|---|---|---|
| 1 | send 시그니처 변경 + 등록 타이밍 오배치(undo했는데 등록 등) | 등록 지점 2곳 한정, undo 경로 E2E 고정 |
| 2 | 최상단 핀이 F1 재정박 불변식 침범 | lib 순수함수 한 곳 수정 + vitest + F1 TC 전체 회귀 |
| 3 | 답장 오판(자동응답/알리아스) | v1 수용·문서화(D6), 규칙 단순 유지(from≠me & date>baseline) |
