# select-all-in-view — Feature PRD

> 2026-07-07 · Goal 1 산출물. 브레인스토밍 중 사용자 무응답(60s) → 추천안 채택 + 근거 기반 설계로 진행(⚠️ DECISIONS D1~D5 미확인, 복귀 시 확인 필요). F1~F6과 달리 스코프가 작아 병렬 deep-reasoner 설계 없이 직접 설계.
> 상위: 사용자 요청 "select all in view 기능 추가" (v1.x 로드맵 F1~F6 완료 후 post-release 추가 기능)

## 1. 목적

현재 스레드 리스트는 j/k 단일 커서 내비게이션만 있고 멀티 선택이 전혀 없다. "지금 보이는(현재 스플릿 탭/라벨 필터 결과) 스레드 전체"를 한 번에 선택해 아카이브/트래시/스누즈/라벨/읽음처리 같은 기존 단축키를 그대로 일괄 적용할 수 있게 한다(Gmail의 "전체 선택" + 툴바 액션과 동등한 개념을 키보드 퍼스트로).

## 2. 범위

### In
- **트리거**: `⌘A` — useKeyboard 소유(모디파이어 조합), 타이핑 중(isTyping)·모달 열림 중에는 발화하지 않아 네이티브 텍스트 선택/기존 모달 단축키와 충돌 없음(D1).
- **대상**: 현재 `visibleThreads(state)`(스플릿 탭 필터링 후, 가상화 여부 무관 필터 결과 전체 — 로드된 페이지 범위, 다음 페이지 미로드분 제외)의 모든 id.
- **상태**: 신규 `bulkSelectedIds: Set<string>` — 비어있으면 평소처럼 단일 커서 모드.
- **일괄 액션**: 기존 단축키(e 아카이브, # 트래시, I/U 읽음, l 라벨, b 스누즈)를 그대로 재사용 — bulk 모드일 때 이 키들이 selectedIndex의 단일 스레드 대신 `bulkSelectedIds` 전체에 적용됨(D2). 라벨/스누즈 피커는 한 번 값을 고르면 선택된 전체에 적용.
- **집계 토스트**: 개별 액션마다 토스트가 뜨면 마지막 것만 남으므로(기존 `toast` 단일 상태), 일괄 액션은 개별 토스트를 억제하고 완료 후 "N개 아카이브됨" 형태의 집계 토스트 1건만 표시(D3).
- **완료 후**: 액션 실행 후 선택 자동 해제(D4) — 정확한 위치 복원보다 "일괄 처리 후 초기화"가 더 예측 가능.
- **취소**: bulk 모드에서 `Escape` → 선택 해제만(액션 없음), 기존 리스트 Escape 규약과 일관.
- **시각 표시**: 선택된 행은 배경을 `bg-accent/10`로 구분(단일 커서의 `bg-bg-subtle`과 다른 톤), 언리드 도트 자리를 체크 표시로 대체(D5). 리스트 상단에 슬림 배너 "N selected — E archive · # trash · Esc cancel" 표시(FollowupBanner 톤 재사용).
- **실행 안전성**: 각 일괄 액션은 기존 `archiveThread(id)` 등을 순차 호출(await 없이 동기 optimistic 부분이 겹치지 않게 완료됨을 코드로 확인됨) — 신규 F4 계측 카테고리·F6 큐 특별 처리 불필요(기존 per-thread 장벽이 그대로 안전).

### Out (v1 범위 외, YAGNI)
- 개별 행 클릭/⌘클릭/Shift클릭 다중 선택 — "select all"만 지원, 범용 멀티셀렉트 시스템은 아님.
- 검색 결과 전체("500개 대화 모두 선택") 같은 미로드 범위 확장.
- compose/reply 등 non-destructive 단일 액션의 bulk 의미 부여.
- 신규 latency 카테고리·집계 대시보드.

## 3. 성공 기준

1. ⌘A로 현재 뷰 전체가 선택되고 배너에 개수가 표시된다.
2. e/#/I/U를 누르면 선택된 전체에 적용되고 집계 토스트가 뜬다. l/b는 피커가 한 번 뜨고 선택 전체에 적용된다.
3. 액션 후 선택이 자동 해제된다. Esc로도 액션 없이 해제된다.
4. 타이핑 중(검색/컴포즈)이나 모달 열림 중에는 ⌘A가 네이티브 동작/기존 단축키를 방해하지 않는다.
5. 기존 E2E 전체 무회귀 + 신규 TC 통과.

## 4. 아키텍처

```
useKeyboard ⌘A → store.selectAllVisible() → bulkSelectedIds = visibleThreads(state).map(id)
ThreadList/ThreadRow: bulkSelectedIds.has(id) → 강조 배경 + 체크 표시
BulkActionBanner(신규): bulkSelectedIds.size>0 표시, 카운트+힌트
useKeyboard e/#/I/U(bulk 모드 분기) → store.archiveSelected()/trashSelected()/markReadSelected()
  → ids.forEach(id => 기존 단일액션 호출, silent:true) → 집계 showToast() → bulkSelectedIds 초기화
SnoozePicker/LabelPicker: bulk 모드면 onConfirm이 단일 대상 대신 전체에 적용
```

신규: `store/mail.ts`(bulkSelectedIds 상태 + selectAllVisible/clearBulkSelection/archiveSelected 등), `components/BulkActionBanner.tsx`. 변경: `ThreadRow.tsx`(체크 표시), `useKeyboard.ts`(⌘A + bulk 분기), `SnoozePicker.tsx`/`LabelPicker.tsx`(bulk 적용 분기), 기존 archiveThread 등에 `silent` 옵션 추가.
