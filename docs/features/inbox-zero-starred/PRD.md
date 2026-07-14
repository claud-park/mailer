# inbox-zero-starred — PRD

> 2026-07-14 · 사용자 버그 리포트 발신. 실계정에서 확정 재현: Gmail 웹 `in:inbox` 검색 = 0건(실제 inbox zero)인데 ZenMail Inbox는 84개 스테일 스레드를 계속 표시. F6 sync-engine의 D14 잔여 리스크("실계정 eventual consistency·외부 변경 수렴")가 실사용에서 발현된 것.

## 문제

1. **외부 아카이브 미수렴(버그)**: ZenMail 밖(Gmail 웹/모바일)에서 아카이브된 스레드가 ZenMail Inbox에서 영원히 사라지지 않는다.
   - 근본 원인: `mail:fetch-threads`의 SWR revalidate가 **upserts만 계산하고 removals를 계산하지 않음**(ipc.ts D1 주석의 의도적 절충). 라벨을 잃은 스레드는 fresh 페이지에 부재할 뿐이라 diff에 잡히지 않고, 캐시 row의 `label_ids`에 INBOX가 영구 잔류 → 모든 cold read가 재서빙.
   - 60s 폴 수렴 가정도 깨져 있음: needsRefetch → renderer `refresh()` → fetch-threads → **같은 스테일 캐시 페이지**를 다시 읽는 루프.
2. **Done ≠ Inbox 탈출 UX(제품 요구)**: 사용자가 기대하는 Superhuman식 시맨틱 —
   - Inbox(및 split 탭)는 done(archived)된 메일을 보여주지 않는다 → inbox zero 도달 가능.
   - **단, starred 메일은 done 되어도 Inbox에 남는다** (unstar 하면 사라짐).

## 요구사항

### R1. 외부 변경 수렴 (버그 수정)
- ZenMail 밖에서 아카이브/트래시된 스레드는 다음 revalidate에서 목록·캐시 모두에서 제거된다.
- 로컬 낙관 뮤테이션(진행 중/큐 대기)과 싸우지 않는다 — 방금 아카이브한 스레드가 스테일 fresh 페이지 때문에 부활하지 않는다(D14 부활 리스크 동시 완화).
- 기존 오염 캐시(사용자 실DB의 84 rows)는 코드 수정만으로 자동 수렴한다(수동 캐시 초기화 없음).

### R2. Inbox 뷰 시맨틱 = INBOX ∪ (STARRED − TRASH − SPAM)
- Inbox·split 탭 목록에 starred 스레드는 archived 여부와 무관하게 표시.
- archive(E)한 starred 스레드는 목록에 남고(위치 유지), unstar 시 (archived면) 목록에서 사라진다.
- TRASH/SPAM은 starred여도 Inbox에 없다. (snoozed 처리: DECISIONS에서 확정)
- 데모(Mock)·실계정(Real)·캐시 리더 3곳의 시맨틱 일치.

### R3. Star 토글 (R2의 성립 조건)
- 현재 앱에 star 기능이 전무 → 최소 star 토글('s')과 목록/상세 표시자 없이는 R2가 조작 불가능한 상태가 됨. 최소 구현을 함께 출하.

## 논스코프
- Starred 전용 뷰(사이드바 항목) — v1 스펙 외.
- Gmail eventual consistency의 완전 해소(직행 경로의 초저확률 레이스는 다음 revalidate 자기치유로 수용, DECISIONS 기록).

## 성공 기준
- 실계정: Gmail 웹에서 아카이브 → ZenMail 다음 revalidate(≤60s) 내 목록에서 제거, inbox zero 상태 표시 도달.
- E2E: 기존 캐논 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) + 신규 TC 전부 PASS ×2연속.
