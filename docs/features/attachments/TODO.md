# attachments — Checkpoint TODO

> Goal 2 산출물. 각 CP는 tsc + npm test 통과, breaking change 시 리뷰 프로토콜(`/react-best-practices` + `/code-review low` → 커밋 → push). **CP5 전까지 기존 E2E 200 PASS·0 FAIL·6 SKIP(SKIP 집합 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`) 무회귀가 설계 불변식.**
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
> **완료 2026-07-15.** 최종 무회귀: E2E **216 PASS·0 FAIL·5 SKIP ×2 결정적**(SKIP 집합은 캐논 6종의 부분집합, TC-SA-B4 정당한 SKIP→PASS 플립 — TC.md/DECISIONS 참조). Goal 5~8(react-best-practices/code-review low/E2E/문서) 전부 clean, 최종 whole-branch 리뷰(Opus)에서 발견된 Critical 1건(다운로드 경로 traversal)과 react-best-practices Critical 1건(effect deps 재fetch 스톰) 모두 fix+재검증 완료.

## CP0. 설계 (Goal 0~4)
- [x] 설계 스펙 확정([2026-07-15-attachments-design.md](../../superpowers/specs/2026-07-15-attachments-design.md)) — 사용자 확정 D1~D3
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. main 레이어 — 첨부 메타데이터 추출 + getAttachment provider + Mock fixture + 데모 시드
- [x] `types.ts`: `AttachmentInfo` 타입 신설(`attachmentId`/`filename`/`mimeType`/`size`/`contentId?`/`inline`) + `MessageDetail.attachments?: AttachmentInfo[]`
- [x] `gmail.ts` `extractBodies()` → `extractParts()`로 확장 — 본문(html/text/ics) 캡처 + `filename`/`body.attachmentId` 파트를 `AttachmentInfo[]`로 수집(순수 `extractAttachments(part)` 헬퍼 분리)
- [x] 인라인 판정: `Content-ID` 헤더 존재 + `Content-Disposition: inline` → `inline: true` + `contentId`(양끝 `<>` 제거)
- [x] `RealGmailProvider.getThread()`가 `attachments`를 노출(비어 있으면 필드 생략, invite 패턴과 동일)
- [x] `GmailProvider.getAttachment(messageId, attachmentId)` 인터페이스 + `RealGmailProvider`(`gmail.users.messages.attachments.get`) 구현
- [x] `MockGmailProvider.getAttachment` + fixture 바이트 맵(`attachmentId → {data, mimeType}`) + `failNextAttachmentCall()` one-shot
- [x] `buildDemoData()`에 첨부 스레드 1건 시드(`demo_att_1`): 인라인 PNG(cid 참조) + PDF + JPEG, 최고령 date로 무회귀 보존
- [x] vitest: `extractAttachments`(인라인/비인라인 분류, contentId 언랩, size/filename) 순수 로직
- [x] tsc + npm test (commit be37717, 리뷰 clean)

## CP2. shared types(ZenmailApi) + IPC 4-파일 계약 + __debug 훅
- [x] `types.ts` `ZenmailApi`: `getAttachmentImage(accountId, messageId, attachmentId, mimeType)` + `downloadAttachment(accountId, messageId, attachmentId, filename)` + `__debugFailNextAttachment?`/`__debugSetDownloadDir?` (⚠️ mimeType 인자는 스펙 대비 조정 — Gmail attachments.get이 mimeType 미반환, plan Global Constraints 참조)
- [x] `src/main/download.ts` 신설: `dedupeDownloadPath(dir, filename)`(충돌 시 `(1)`,`(2)`… 리네임) + `writeDownload(dir, filename, buffer)` — 순수/파일 I/O 분리
- [x] `ipc.ts`: `mail:get-attachment-image`(image mimetype → data URI, 실패 시 `{error}`) + `mail:download-attachment`(다운로드 dir → 리네임 → writeFile, `{savedPath}`/`{error}`) — sqlite 무저장(fresh fetch)
- [x] `ipc.ts` `__debug`: `mail:debug-fail-next-attachment`(activeCtx mock 1회 실패) + `mail:debug-set-download-dir`(E2E dir 오버라이드)
- [x] `preload.ts`: 2메서드 + 2 debug 훅 노출
- [x] vitest: `dedupeDownloadPath` 충돌 리네임(`foo.pdf`→`foo (1).pdf`→`foo (2).pdf`, 확장자 없는 파일) 순수 로직
- [x] tsc + npm test (commit 114b623, 리뷰 clean)

## CP3. renderer 인라인 cid: 이미지 해석(prepareHtml/MessageCard)
- [x] `mail.ts` 스토어: `fetchAttachmentImage(messageId, attachmentId, mimeType): Promise<{dataUri,mimeType}|{error}>` 액션(accountId 주입)
- [x] `ThreadView.tsx` `prepareHtml(message, opts, inlineImages)` — sanitize 후 `img[src^="cid:"]` src를 `inlineImages`의 data URI로 치환
- [x] `MessageCard` `inlineImages: Map<contentId, dataUri>` state — mount 시 `inline && image/*` 항목 병렬 fetch, 도착 순 갱신 → `useMemo` deps에 `inlineImages`
- [x] ⚠️ remote-image 게이트(`allowImages`)와 분리 — cid는 게이팅 없이 자동 로드(CSP `img-src data:` 현행 유지)
- [x] tsc + npm test (commit 6c56bb9, 리뷰 clean)
- [x] **후속 fix(react-best-practices Critical)**: effect deps에서 `message.attachments`(객체 참조) 제거, `message.id`만 유지 — SWR revalidate 시 재fetch 스톰 방지 (commit 36623cf)

## CP4. renderer 첨부 스트립 + 썸네일 + 라이트박스
- [x] `mail.ts` 스토어: `lightboxImage: {dataUri, filename}|null` + `openLightbox(img)`/`closeLightbox()` + `downloadAttachment(messageId, attachmentId, filename): Promise<void>`(성공/실패 토스트) + `ACCOUNT_SCOPED_RESET`에 `lightboxImage:null`
- [x] `ThreadView.tsx` `AttachmentStrip` — `attachments.filter(a=>!a.inline)` 렌더, mimetype 아이콘 + 파일명 + 용량, 이미지 항목 썸네일 병렬 fetch, 항목 fetch 실패 시 인라인 에러 + 재시도, 다운로드 버튼
- [x] `AttachmentStrip`을 `MessageCard`의 iframe 아래에 마운트
- [x] `Lightbox.tsx` 신설 — 오버레이 템플릿(backdrop+Esc+stopPropagation), `s.lightboxImage`로 구동, `App.tsx`에 마운트
- [x] ⚠️ `useKeyboard.ts` modal guard 배열 + Esc-close 블록 **두 곳 모두**에 `lightboxImage !== null` 등록
- [x] tsc + npm test (commit a80ce2a, 리뷰 clean)
- [x] 데모 확인: E2E TC-ATT-A~C(CP5)로 인라인 로고 렌더·스트립·썸네일→라이트박스·Esc 전부 실제 DOM 검증(헤드리스 환경이라 수동 GUI 확인 대신 CDP E2E로 대체)

## CP5. E2E TC-ATT 전건 + 무회귀 (Goal 5~8)
- [x] TC-ATT-A1~A2 (인라인 cid 렌더 `img[src^="data:"]`, 게이트 우회 자동 로드)
- [x] TC-ATT-B1~B3 (비인라인 스트립 노출, 인라인 제외, 파일명/용량)
- [x] TC-ATT-C1~C4 (썸네일 표시, 클릭→라이트박스, Esc 닫힘, 배경 단축키 차단)
- [x] TC-ATT-D1~D2 (다운로드 클릭→저장 경로 토스트, 충돌 `(1)` 리네임)
- [x] TC-ATT-E1~E2 (fetch 실패 주입 항목 단위 에러+나머지 정상, 다운로드 실패 토스트)
- [x] TC-ATT-F1~F2 (vitest — extractAttachments · dedupeDownloadPath 순수 로직, traversal 케이스 포함) · TC-ATT-G1~G2 (회귀 게이트)
- [x] 기존 E2E 무회귀 재실행 ×2 결정적 — 0 FAIL + SKIP 집합 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`의 부분집합(TC-SA-B4가 신규 데모 시드로 SKIP→PASS 정당 전환, 5개) + 총계 216
- [x] `/react-best-practices` — Critical 1건(effect deps 재fetch 스톰) 발견·fix·재검증(commit 36623cf)
- [x] 최종 whole-branch 리뷰(Opus) — Critical 1건(다운로드 경로 traversal, 첨부파일명이 이메일 발신자 임의 지정 가능해 `../../` 류로 Downloads 밖 임의 쓰기 가능) 발견·fix(`path.basename` 새니타이즈 + traversal 회귀 테스트 3건, commit 13b72f4)·재검증(Ready to merge: Yes)
- [x] `/code-review low` — (none), 3회 독립 리뷰(태스크별+whole-branch+react-best-practices) 이후 hunk 가시 런타임 버그 0건
- [x] TC/TODO/DEV_WORKFLOW/루트 TODO 갱신 + Obsidian 기록
