# ZenMail — UX 개선 3건 (Design Spec)

> 2026-07-16 · 사용자 요청: "UX를 개선할 수 있는 아이디어를 3개 도출(plan) 하고 실행해". 기존 PRD/RESEARCH_SUPERHUMAN/TODO 백로그/DECISIONS 조사(Explore 에이전트) 기반으로 3건 도출 → 사용자 확정.
> 사용자 확정 3건(공통): ① 3개 아이디어 그대로 진행, ② Undo 대상=Archive/Trash/Snooze/Label 4종 전부, ③ 라벨 삭제 확인 다이얼로그 필요.
> feature slugs: `undo-toast`, `label-crud`, `snippets-inline-reply` (각각 DEV_WORKFLOW Goal 0~8 대상).

## 근거 (Explore 조사 요약)

- **undo-toast**: `toast: string`(mail.ts)은 Send에만 있는 별도 `pendingSend`/`undoSend` 메커니즘과 달리 Archive/Trash/Snooze/Label-apply는 일반 확인 문자열뿐 — undo 없음(코드로 직접 확인). 실패 롤백용 `captureRemoval`/`rollbackRemoval`이 이미 존재해 재사용 가능.
- **label-crud**: `post-release 버그수정 3건`·`starred-view` 두 feature의 TODO 항목에 "label 사이드바 추가·삭제는 별도 세션 예정"이 두 번 반복 기록된 확정 백로그.
- **snippets-inline-reply**: `detail-density` DECISIONS D12가 "InlineReply 확장은 out of scope for v1, backlog"로 명시. Gmail `labels.create`/`labels.delete` API는 이미 `snoozeLabelId()`에서 사용 중이라 provider 레벨 패턴이 검증돼 있음.

---

## 1. undo-toast

### 데이터 모델
`toast: string | null` → `toast: { msg: string; undo?: () => void } | null`(만료는 기존 `showToast`의 4s 타이머 재사용 로직과 별개로 undo 전용 만료 관리 필요 — 아래 참고). 모든 `showToast('메시지')` 호출부는 무변경(undo 없는 토스트는 여전히 문자열 오버로드로 호출), undo가 필요한 지점만 `showToast('메시지', { undo: fn })` 형태로 확장.

### 각 액션의 undo 구현
- **Archive**: `capture = captureRemoval(threads, id)` 이미 실패 롤백에 사용 중 — 성공 시에도 5초간 이 캡처를 들고 있다가, undo 클릭 시 `rollbackRemoval(capture)`(로컬 복원) + `api().modifyLabels(a, {threadId:id, addLabelIds:['INBOX'], removeLabelIds:[]})`(서버에 INBOX 재부여 — 이미 성공한 archive를 되돌리는 보정 호출, 실패-롤백과 달리 서버가 이미 변경된 상태이므로 반드시 필요).
- **Trash**: 동일 패턴, undo 시 `addLabelIds:['INBOX'], removeLabelIds:['TRASH']`.
- **Label-apply**: undo 시 방금 추가한 라벨만 `removeLabelIds`로 제거.
- **Snooze**: undo 시 스누즈 자체를 취소해야 함 — `cache.removeSnooze(threadId)`는 이미 존재(main, snooze 데몬이 내부적으로 씀)하나 IPC로 노출 안 됨 → 신규 IPC `mail:cancel-snooze` 추가(캐시 removeSnooze + `modifyLabels`로 원래 라벨 복원: zenmail/snoozed 제거 + INBOX 재부여).
- **Bulk(archiveSelected 등)**: 여러 thread의 capture를 배열로 들고 있다가 undo 시 전부 되돌림 — 집계 토스트("N개 아카이브됨")에 undo 버튼 하나로 전체 복원.

### UI
`Toasts.tsx`의 일반 토스트 블록에 `toast.undo`가 있으면 `UndoSendToast`와 동일한 시각 패턴(버튼)으로 노출. 5초 후 자동 소멸(만료되면 undo 콜백은 그냥 폐기 — 이미 서버에 반영된 상태가 영구화됨, 정상). 여러 토스트가 연속으로 뜨는 경우(빠른 연속 액션) 최신 토스트가 이전 것을 대체(현재 `toast` 단일 슬롯 구조 유지 — 큐잉은 YAGNI).

### 논스코프
- Star/Unstar undo — 별표는 이미 즉시 토글 가능(`s` 다시 누르면 원복)이라 실효성 낮음, 추가 안 함.
- 토스트 큐(여러 개 동시 표시) — 단일 슬롯 유지.

---

## 2. label-crud

### 생성
사이드바 "Labels" 헤더 옆에 `+` 버튼 → 클릭 시 헤더 자리가 인라인 텍스트 입력으로 전환(이름만, 색상은 Gmail 기본값 자동 할당 — Gmail이 자체 팔레트에서 배정). Enter로 확정 → `api().createLabel(accountId, name)` → 성공 시 `labels` 배열에 낙관적으로 추가, 실패 시 롤백+토스트. Esc로 취소.

### 삭제
각 라벨 행에 hover 시 우측에 ✕ 아이콘 노출(라벨 dot/이름과 겹치지 않게 행 우측 정렬, 기존 unread 배지와 같은 자리 — 배지 없을 때만 보이거나 배지 앞에 배치). 클릭 → 확인 다이얼로그("'{name}' 라벨을 삭제하면 모든 메일에서 제거됩니다" + 삭제/취소 버튼, 기존 SnoozePicker류 모달 오버레이 패턴 재사용) → 확정 시 `api().deleteLabel(accountId, labelId)`, 성공 시 `labels`에서 제거(+ 그 라벨을 보고 있었다면 Inbox로 복귀), 실패 시 토스트+목록 무변경.

### Provider/IPC
`GmailProvider`에 `createLabel(name): Promise<Label>`/`deleteLabel(labelId): Promise<void>` 추가. Real은 `gmail.users.labels.create`/`labels.delete`(기존 `snoozeLabelId()`가 이미 쓰는 API, 새 의존성 0). Mock은 `this.labels`/`this.threads`에 대한 in-memory 반영(삭제 시 해당 라벨을 가진 모든 스레드의 labelIds에서도 제거 — 실제 Gmail 동작과 동치).

### 논스코프
- 라벨 이름 변경(rename) — 사용자가 "추가·삭제"만 요청, YAGNI.
- 색상 직접 선택 UI — Gmail 기본 자동 배정으로 충분.
- 중첩 라벨(부모/자식) — v1 스펙 밖.

---

## 3. snippets-inline-reply

### 메커니즘
`ThreadView.tsx`의 `InlineReply` 컴포넌트에 Compose.tsx와 동일한 패턴을 포팅: 로컬 `snippetOpen`/`savedRangeRef` state, `contentEditable` div의 `onKeyDown`에 `⌘;` 캡처(현재 InlineReply의 onKeyDown은 `⌘Enter`만 처리 — 그 옆에 분기 추가) → 캐럿 위치 저장 → `<SnippetsPicker>`(Compose가 쓰는 것과 동일 컴포넌트, `onInsert` prop만 다르게 연결) 오픈 → `insertSnippet(body)`: `execCommand('insertText', ...)` 우선 시도, 실패 시 `Range.insertNode(textToFragment(body))` 폴백(Compose와 완전히 동일한 로직 — 1-스텝 undo 호환성 이유도 동일하게 적용됨).

### 상태 동기화
InlineReply는 `contentEditable`의 `onInput`으로 `body`(전송용 HTML) state를 직접 관리 중 — snippet 삽입 후에도 동일하게 `onInput`이 자연히 발화해 `body`가 갱신됨(Compose와 동일 보장, 별도 처리 불요).

### 논스코프
- Snippets 자체의 CRUD(SnippetsManager) — 이미 존재, 무변경.
- InlineReply 전용 단축키 힌트 UI 변경 — 없음, 그대로.

---

## 공통 검증 계획
- vitest: `insertSnippet`류 순수 로직이 있다면 단위화(현재 Compose도 DOM 조작이 섞여 있어 단위테스트 어려움 — E2E가 주 검증 수단, 기존 Snippets 관례와 동일), `createLabel`/`deleteLabel` provider 로직은 순수 함수로 뽑을 수 있는 부분만.
- E2E: 3건 모두 신규 TC 프리픽스(`TC-UNDO-*`, `TC-LBL-*`, `TC-SNIP-*`) 추가, 기존 스위트 무회귀 확인 ×2.
- 최종 게이트: 3건 통합 whole-branch 리뷰(스코프가 starred-view보다 작아 개별 리뷰보다 통합이 효율적) + `/react-best-practices` + `/code-review low` 1회씩(통합).
