# starred-view — DECISIONS

> 2026-07-16. 브레인스토밍(대화형, 4문항) 산출물. D1~D4는 사용자 확정, D5~D9는 구현 세부를 다루는 추천안(D9는 최종 전체 브랜치 리뷰에서 발견·수정).

## D1. Starred 배치 = 사이드바 시스템 항목 — 사용자 확정
- **선택지**: (a) 사이드바 고정 항목(Inbox/Sent/Drafts와 동격, Split Inbox on/off 무관하게 항상 접근), (b) 기존 split-inbox-plus 탭바에 고정 탭으로 추가(단, 사용자가 ⌘⇧I로 Split Inbox 자체를 끄면 Starred도 같이 사라짐), (c) 둘 다(중복 노출).
- **선택**: (a) 사이드바 시스템 항목.
- **이유**: Starred는 사용자 커스텀 규칙이 아니라 Gmail 표준 개념이라 "항상 켜져 있어야" 자연스럽다 — Split Inbox는 토글 가능한 선택 기능인데 그 on/off에 Starred 접근성이 종속되면 예측 불가능하다. Gmail 웹 자체도 카테고리 탭과 별개로 좌측 고정 네비에 Starred를 둔다.

## D2. Starred 범위 = STARRED − Trash/Spam − 스누즈 — 사용자 확정
- **선택지**: (a) STARRED 라벨 전체에서 Trash/Spam/스누즈만 제외, (b) Gmail `is:starred` 그대로(제외 없음 — 휴지통에 간 starred도 노출).
- **선택**: (a).
- **이유**: 기존 Inbox 뷰가 이미 이 exclusion 3종을 쓰고 있었고(D6, inbox-zero-starred), 사용자가 그 규칙을 그대로 유지하길 원함 — 스누즈 중인 메일이 Starred에도 "숨어있다 나중에 나타나는" 것이 Inbox와 동일한 멘탈 모델을 유지한다. 휴지통에 버린 메일이 Starred에 계속 뜨는 건(b) 대부분의 사용자에게 놀랍다.

## D3. Inbox 뷰 = 순수 INBOX 라벨로 복귀 — 사용자 확정
- **선택지**: (a) `isInInboxView`에서 STARRED 유니온 제거(순수 INBOX), (b) 유니온 유지 + Starred를 추가 뷰로만 노출(중복 표시 허용).
- **선택**: (a).
- **이유**: 사용자가 명시한 "default inbox should be zeroed out"은 (b)로는 달성 불가 — archived-starred가 여전히 Inbox 카운트를 오염시킨다. Starred가 전용 뷰로 생기는 이상, Inbox에 겹쳐 보일 이유가 없다(Gmail 웹도 Starred 라벨 자체가 Inbox 카운트에 안 얹힌다).
- **영향**: `docs/features/inbox-zero-starred/DECISIONS.md` D1(술어)·D2(q 번역)·D4(removal 대상 라벨)·D7("사이드바 Starred 뷰는 논스코프")을 supersede. 그 문서는 과거 스냅샷으로 보존하고 수정하지 않는다 — 이 문서가 최신 진실.

## D4. 단축키 `g t`(Starred), `g s`는 Sent 유지 — 사용자 확정
- **선택지**: (a) `g t`=Starred 신설, 기존 `g s`=Sent 무변경, (b) 실제 Gmail 관습(`g s`=starred, `g t`=sent)에 맞춰 재배치.
- **선택**: (a).
- **이유**: ZenMail은 이미 `g s`=Sent로 자리잡았고(실제 Gmail과 다르지만 ZenMail 자체 관습), 기존 사용자 근육기억을 깨는 비용이 실제 Gmail과의 일치보다 크다고 판단.

## D5. archiveThread/toggleStar 게이트 일반화 — 추천안
- **컨텍스트**: `archiveThread`의 "keepInPlace" 게이트가 `viewLabel === 'INBOX'`로 하드코딩돼 있고, `toggleStar`의 unstar 분기는 `viewLabel !== 'INBOX'`면 무조건 유지하는 단축 조건이 있음. 둘 다 STARRED 뷰를 새로 추가하려면 손대야 한다.
- **선택지**: (a) 두 게이트를 각각 `viewLabel === 'INBOX' || viewLabel === 'STARRED'`로 넓히고, 판정에는 이미 있는 `inLabelView(nextLabels, viewLabel, snoozeLabelId)`를 그대로 재사용(unstar의 단축 조건은 제거), (b) STARRED 전용 별도 분기를 새로 작성(코드 중복).
- **선택**: (a).
- **이유**: `inLabelView`가 이미 뷰-라벨 매개변수를 받는 범용 함수라 게이트만 넓히면 로직 재작성이 불필요 — 사이드바 라벨 5종에도 같은 패턴이 이미 있다(Sent/Drafts/커스텀 라벨은 게이트 밖이라 무조건 제거 분기로 떨어지는데, 이건 기존 동작 그대로 유지). unstar의 단축 조건 제거가 유일한 실질 변경점이며, Explore 조사에서 4칸 매트릭스(PRD R3)를 전부 손으로 추적해 회귀 없음을 확인했다.

## D6. TC-IZ-* 재작성(폐기 아님) — 추천안
- **선택지**: (a) 기존 9건 중 시맨틱이 바뀐 4건(B1~B3,B7)만 새 기대값으로 재작성하고 나머지 5건(A1~A4,B4~B6)은 유지, (b) `TC-IZ-*` 전체를 삭제하고 `TC-STAR-*`로 완전히 새로 씀.
- **선택**: (a).
- **이유**: A-그룹(외부 수렴 메커니즘)과 B4~B6(TRASH/SPAM/스누즈 배제)은 STARRED 유니온과 무관하게 여전히 유효한 회귀 방지 자산이다 — 통째로 버리면 그 커버리지를 처음부터 다시 설계해야 한다. 재작성이 정확히 "무엇이 바뀌었고 왜"를 문서에 남기는 이 프로젝트의 관례(calendar-integration D10, attachments 문서 정정 패턴)와도 맞는다.

## D7. Mock provider에 STARRED 시스템 라벨 시드 추가 — 추천안
- **컨텍스트**: 사이드바 Starred 배지가 `labels` 배열의 STARRED 엔트리 `unreadCount`를 읽는데, 데모 시드의 라벨 목록에 STARRED 항목이 아예 없다(Real Gmail은 시스템 라벨이라 자동으로 옴).
- **선택**: 데모 시드 라벨 배열에 `{ id: 'STARRED', name: 'Starred', type: 'system' }` 추가.
- **이유**: 안 하면 데모 모드에서 배지가 항상 비어(undefined) E2E로 검증 불가능하고, 실계정과 데모 간 시맨틱이 갈린다(F6 이후 프로젝트 전반의 "데모=실계정 패리티" 원칙 위반).

## D8. `externalUnstar` 디버그 훅 신설 — 추천안
- **컨텍스트**: `inbox-zero-starred`가 `__debugExternalArchive`(provider만 라벨 제거, 캐시·modifyLabels 우회)로 "Gmail 웹에서 아카이브" 외부 변경을 재현해 SWR 수렴을 검증했다. Starred 뷰도 동일한 클래스의 시나리오("Gmail 웹에서 별표 해제")를 검증해야 하는데 대칭 훅이 없다.
- **선택**: `MockGmailProvider.__debugExternalUnstar(threadId)` 신설(STARRED 라벨만 벗기는 것 외 `externalArchive`와 동일 구조), mock 전용(Real provider엔 불필요 — 실계정에서는 실제로 Gmail 웹을 조작해 검증하는 방식, 기존 관례와 동일).
- **이유**: 대칭적인 디버그 훅 없이는 TC-STAR-C1(외부 unstar 수렴)을 자동화할 방법이 없고, 이는 정확히 inbox-zero-starred가 고쳤던 버그 클래스(SWR revalidate가 removal을 놓치는 것)의 Starred 버전이 나중에 조용히 재발해도 잡을 방법이 없다는 뜻이다.

## D9. `viewMembershipLabels`는 INBOX/STARRED 어느 쪽에서 벗겨지든 둘 다 벗긴다 — 최종 리뷰 발견·수정
- **컨텍스트**: CP1 구현 당시 `viewMembershipLabels`를 "뷰가 이제 단일 라벨이니 자기 라벨만 벗기면 된다"로 단순화했다(`[viewLabel]`). 최종 전체 브랜치 리뷰(deep-reasoner/Opus)가 이것이 실제 버그임을 발견: revalidate의 removal 판정은 "그 뷰의 fresh 목록에 없다"는 사실만 알 뿐 **왜** 없는지(정의 라벨을 잃었는지, 배제 라벨 TRASH/SPAM을 얻었는지)는 모른다. `applyLabelDelta`는 지정된 라벨만 벗기는 델타 병합이라, STARRED 뷰에서만 벗기면 그 스레드가 사실은 외부에서 TRASH로 이동해 STARRED는 그대로인 경우에도 캐시엔 여전히 stale한 INBOX가 남는다 — 이후 사용자가 Inbox로 전환하면 "0이어야 할" Inbox에 휴지통 메일이 순간적으로 새어 든다(핵심 성공 기준 R1 위반 시나리오).
- **선택지**: (a) INBOX/STARRED 뷰 모두 벗길 때 `['INBOX','STARRED']` 둘 다 벗긴다(inbox-zero-starred D4가 원래 union 뷰에 적용했던 논리를 두 개별 뷰 모두로 확장), (b) revalidate가 반대쪽 뷰의 fresh 집합도 같이 조회해 정확한 원인을 판별한다(왕복 요청 2배, 상당한 리팩터), (c) 그대로 두고 자기치유 성격만 문서화(수정 안 함).
- **선택**: (a).
- **이유**: (b)는 매 revalidate마다 추가 API 왕복이 필요해 비용 대비 효과가 낮고 이번 세션 범위를 크게 벗어난다. (c)는 이 기능 자체의 존재 이유(R1 "Inbox는 항상 0으로 수렴")를 정면으로 위반하는 케이스라 그냥 넘기기엔 무겁다. (a)는 한 줄 변경이며 안전성이 증명 가능하다: 잘못 벗겨낸 라벨이 실제로는 아직 유효하면, 그 라벨이 정의하는 뷰 자신의 다음 revalidate가 fresh 응답의 전체 라벨을 그대로 upsert해(델타 병합이 아니라 서버 원본 덮어쓰기) 스스로 복구한다 — 유일한 부작용은 "정말로 unstar만 됐을 뿐인 INBOX 스레드가 STARRED 뷰 revalidate에 의해 잠깐 Inbox에서도 사라졌다가 Inbox 자신의 다음 revalidate로 복구되는" 훨씬 온건한 반대 방향 깜빡임인데, 이는 "Inbox에 없어야 할 게 보이는" 원래 결함보다 훨씬 안전한 실패 방향이다(과소 표시가 과다 표시보다 이 기능의 취지에 부합). INBOX/STARRED가 아닌 다른 라벨 뷰(Sent/Drafts/커스텀 라벨)는 이 배제 규칙 공유가 없으므로 자기 라벨만 벗기는 기존 동작 그대로 유지.
- **검증**: `view.test.ts`에 `viewMembershipLabels('INBOX')`/`('STARRED')` 둘 다 `['INBOX','STARRED']`를 반환하는지 확인하는 회귀 테스트 추가(vitest 26 PASS 유지). E2E 레벨(외부에서 별표 유지한 채 trash하는 특정 레이스)까지의 전용 자동화는 이번 범위 밖으로 남김 — 자기치유적이고 재현에 새 디버그 훅(`__debugExternalTrash`)이 필요해 비용 대비 낮은 우선순위로 판단(후속 과제 후보).
