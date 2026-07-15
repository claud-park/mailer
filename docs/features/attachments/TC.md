# attachments — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs, TC-ATT-*). ground truth: DOM + 기존 `--zenmail-e2e` 게이트의 `__debug` 훅(첨부 fetch 실패 주입 `__debugFailNextAttachment`, E2E 다운로드 dir 오버라이드 `__debugSetDownloadDir`) + vitest(extractAttachments · dedupeDownloadPath 순수 로직).
> **데모 시드 전제**(모든 TC의 If에 반영): `buildDemoData()`는 첨부 스레드 `demo_att_1`(subject `Attachments: brand kit`)을 시드한다 — 본문에 인라인 서명 로고 PNG 1건(`Content-Disposition: inline`, `Content-ID: <logo@zenmail>`, 본문에서 `cid:logo@zenmail` 참조), 비인라인 첨부 PDF 1건(`brand-guide.pdf`), JPEG 1건(`cover.jpg`). `MockGmailProvider`는 이 세 첨부의 바이트를 fixture 맵으로 보유한다. `demo_att_1`은 어떤 split 규칙에도 매칭되지 않는 발신자(`design@brandco.example`)와 최고령 date로 시드해 기존 split 카운트/순서 무회귀를 보존한다.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)

## A. 인라인 cid: 이미지 (ThreadView prepareHtml)

- [ ] **TC-ATT-A1** If 데모 시드의 `demo_att_1` 스레드를 열면, When `MessageCard`가 인라인 이미지 fetch를 완료하면, Then 본문 iframe 안의 `img[src^="cid:"]`가 `img[src^="data:"]`로 치환되어 로고가 깨지지 않고 렌더된다.
- [ ] **TC-ATT-A2** If `demo_att_1`을 열면, When "Load remote images" 버튼을 누르지 않은 상태여도, Then 인라인 cid 이미지는 자동으로 로드된다(remote-image 게이트와 분리 — cid는 게이팅 없이 표시).

## B. 첨부 스트립 (비인라인 목록)

- [ ] **TC-ATT-B1** If `demo_att_1`을 열면, When `AttachmentStrip`이 렌더되면, Then 비인라인 첨부(`brand-guide.pdf`, `cover.jpg`) 항목이 파일명과 함께 스트립에 노출된다.
- [ ] **TC-ATT-B2** If `demo_att_1`을 열면, When `AttachmentStrip`이 렌더되면, Then 인라인 서명 로고(`inline: true`, cid 참조)는 스트립에 노출되지 않는다(중복 노출 방지).
- [ ] **TC-ATT-B3** If `demo_att_1`을 열면, When 스트립 항목을 확인하면, Then 각 항목에 mimetype 아이콘 + 파일명 + 사람이 읽는 용량(KB/MB) 문자열이 표시된다.

## C. 썸네일 & 라이트박스

- [ ] **TC-ATT-C1** If `demo_att_1`을 열면, When 이미지 첨부(`cover.jpg`) 썸네일 fetch가 완료되면, Then 해당 항목에 썸네일(`img[src^="data:"]`)이 표시된다(비이미지 PDF 항목은 아이콘만).
- [ ] **TC-ATT-C2** If 이미지 첨부 썸네일이 표시된 상태에서, When 썸네일을 클릭하면, Then 라이트박스 오버레이(`[data-testid="attachment-lightbox"]`)가 확대 이미지와 함께 열린다.
- [ ] **TC-ATT-C3** If 라이트박스가 열려 있으면, When `Esc`를 누르거나 backdrop을 클릭하면, Then 라이트박스가 닫힌다.
- [ ] **TC-ATT-C4** If 라이트박스가 열려 있으면, When 배경에서 단축키(예: `e` 아카이브)를 누르면, Then 해당 단축키가 실행되지 않는다(`useKeyboard.ts` modal guard로 차단).

## D. 다운로드

- [ ] **TC-ATT-D1** If `__debugSetDownloadDir`로 E2E 다운로드 폴더를 지정한 상태에서 `demo_att_1`을 열면, When `brand-guide.pdf`의 다운로드 버튼을 누르면, Then 저장 경로 토스트("다운로드 완료 · …/brand-guide.pdf")가 뜨고 파일이 해당 폴더에 존재한다.
- [ ] **TC-ATT-D2** If 같은 첨부를 이미 한 번 다운로드한 상태에서, When 다시 다운로드 버튼을 누르면, Then 기존 파일을 덮어쓰지 않고 `brand-guide (1).pdf`로 리네임되어 저장된다(저장 경로 토스트가 `(1)`을 포함).

## E. 에러 처리

- [ ] **TC-ATT-E1** If `__debugFailNextAttachment`로 다음 첨부 fetch 실패를 주입한 상태에서 `demo_att_1`을 열면, When 썸네일/인라인 이미지 fetch가 실패하면, Then 해당 항목만 인라인 에러(`[data-testid="attachment-error"]` + 재시도) 상태가 되고, 메시지 카드의 나머지(본문·다른 첨부)는 정상 동작한다(크래시 없음).
- [ ] **TC-ATT-E2** If `__debugFailNextAttachment`로 실패를 주입한 상태에서, When 다운로드 버튼을 누르면, Then 에러 토스트("다운로드 실패")가 뜨고 앱이 계속 정상 동작한다(모달 없음).

## F. vitest — 순수 로직

- [ ] **TC-ATT-F1** If MIME 트리에 본문 파트와 `filename`/`body.attachmentId` 파트가 섞여 있으면, When `extractAttachments`를 호출하면, Then 첨부 파트만 `AttachmentInfo[]`로 수집되고 `Content-ID`+`Content-Disposition: inline` 파트는 `inline: true`+`contentId`(양끝 `<>` 제거), 그 외는 `inline: false`로 분류된다.
- [ ] **TC-ATT-F2** If 다운로드 폴더에 `foo.pdf`가 이미 존재하면, When `dedupeDownloadPath(dir, 'foo.pdf')`를 호출하면, Then `foo (1).pdf`를 반환하고, `foo (1).pdf`도 존재하면 `foo (2).pdf`를 반환한다(확장자 없는 파일은 `foo` → `foo (1)`).

## G. 회귀 게이트

- [ ] **TC-ATT-G1** If attachments 전체가 배선된 상태면, When 기존 E2E 전건을 돌리면, Then 기존 캐논이 0 FAIL로 유지되고 SKIP 집합이 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`의 부분집합이며(신규 SKIP 없음), 총 어서션 = 기존 총계(200) + 신규(TC-ATT 15)이다.
- [ ] **TC-ATT-G2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 vitest(`extractAttachments`·`dedupeDownloadPath`, TC-ATT-F1~F2 포함) 전부 통과한다.

> 목표 집계: E2E **215 PASS · 0 FAIL · 6 SKIP**(200 + TC-ATT-A1~A2·B1~B3·C1~C4·D1~D2·E1~E2·G1~G2 = 15). F1~F2는 vitest(`npm test`)에서 커버되며 TC-ATT-G2 게이트가 이를 참조한다. SKIP 집합 무변경(신규 SKIP 없음).
