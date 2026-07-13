# light-mode — Test Cases (If-When-Then)

> Goal 3 산출물. E2E는 run-tc.mjs 확장(TC-LM-*). 플랜 Task 6 1:1 대응.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP

## A. 기본값·토글·영속화

- [ ] **TC-LM-A1** If 앱을 처음 실행하면(설정 없음), When 렌더러가 부트되면, Then `document.documentElement.dataset.theme`이 미설정(=light)이고 `getComputedStyle(document.body).backgroundColor`가 `rgb(255, 255, 255)`이다.
- [ ] **TC-LM-A2** If 라이트 상태면, When `toggleTheme()`을 실행하면(kbar "Toggle light/dark theme" 경유), Then `dataset.theme === 'dark'`이고 body 배경이 `rgb(15, 15, 15)`이다.
- [ ] **TC-LM-A3** If dark로 토글한 직후면, When 앱을 재시작하면, Then dark 상태가 유지된다(SQLite settings KV persist, F1 영속화 TC와 동일 restart 검증 패턴).
- [ ] **TC-LM-A4** If dark 상태로 재시작 확인이 끝났으면, When 다시 토글해 light로 되돌리고 재시작하면, Then light 상태가 유지된다(이 TC가 마지막에 테마를 light로 정리 — 다른 TC에 영향 없게 함).

## B. iframe 즉시 반영

- [ ] **TC-LM-B1** If 스레드가 열려 있고(iframe srcDoc 렌더됨) 상태면, When 테마를 토글하면, Then `iframe.contentDocument.body`의 computed color가 즉시 바뀐다(재열기 불필요).

## C. 회귀

- [ ] **TC-LM-C1** If light-mode가 배선된 상태면, When 기존 전체 E2E를 돌리면, Then 전부 기존 상태를 유지한다(직전 스냅샷 기준 무회귀).
- [ ] **TC-LM-C2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 스위트 포함 전부 통과한다.
