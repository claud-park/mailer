# attachments — Checkpoint TODO

> Goal 2 산출물. 각 CP는 tsc + npm test 통과, breaking change 시 리뷰 프로토콜(`/react-best-practices` + `/code-review low` → 커밋 → push). **CP5 전까지 기존 E2E 200 PASS·0 FAIL·6 SKIP(SKIP 집합 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`) 무회귀가 설계 불변식.**
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 설계 스펙 확정([2026-07-15-attachments-design.md](../../superpowers/specs/2026-07-15-attachments-design.md)) — 사용자 확정 D1~D3
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. main 레이어 — 첨부 메타데이터 추출 + getAttachment provider + Mock fixture + 데모 시드
- [ ] `types.ts`: `AttachmentInfo` 타입 신설(`attachmentId`/`filename`/`mimeType`/`size`/`contentId?`/`inline`) + `MessageDetail.attachments?: AttachmentInfo[]`
- [ ] `gmail.ts` `extractBodies()` → `extractParts()`로 확장 — 본문(html/text/ics) 캡처 + `filename`/`body.attachmentId` 파트를 `AttachmentInfo[]`로 수집(순수 `extractAttachments(part)` 헬퍼 분리)
- [ ] 인라인 판정: `Content-ID` 헤더 존재 + `Content-Disposition: inline` → `inline: true` + `contentId`(양끝 `<>` 제거)
- [ ] `RealGmailProvider.getThread()`가 `attachments`를 노출(비어 있으면 필드 생략, invite 패턴과 동일)
- [ ] `GmailProvider.getAttachment(messageId, attachmentId)` 인터페이스 + `RealGmailProvider`(`gmail.users.messages.attachments.get`) 구현
- [ ] `MockGmailProvider.getAttachment` + fixture 바이트 맵(`attachmentId → {data, mimeType}`) + `failNextAttachmentCall()` one-shot
- [ ] `buildDemoData()`에 첨부 스레드 1건 시드(`demo_att_1`): 인라인 PNG(cid 참조) + PDF + JPEG, 최고령 date로 무회귀 보존
- [ ] vitest: `extractAttachments`(인라인/비인라인 분류, contentId 언랩, size/filename) 순수 로직
- [ ] tsc + npm test

## CP2. shared types(ZenmailApi) + IPC 4-파일 계약 + __debug 훅
- [ ] `types.ts` `ZenmailApi`: `getAttachmentImage(accountId, messageId, attachmentId, mimeType)` + `downloadAttachment(accountId, messageId, attachmentId, filename)` + `__debugFailNextAttachment?`/`__debugSetDownloadDir?` (⚠️ mimeType 인자는 스펙 대비 조정 — Gmail attachments.get이 mimeType 미반환, plan Global Constraints 참조)
- [ ] `src/main/download.ts` 신설: `dedupeDownloadPath(dir, filename)`(충돌 시 `(1)`,`(2)`… 리네임) + `writeDownload(dir, filename, buffer)` — 순수/파일 I/O 분리
- [ ] `ipc.ts`: `mail:get-attachment-image`(image mimetype → data URI, 실패 시 `{error}`) + `mail:download-attachment`(다운로드 dir → 리네임 → writeFile, `{savedPath}`/`{error}`) — sqlite 무저장(fresh fetch)
- [ ] `ipc.ts` `__debug`: `mail:debug-fail-next-attachment`(activeCtx mock 1회 실패) + `mail:debug-set-download-dir`(E2E dir 오버라이드)
- [ ] `preload.ts`: 2메서드 + 2 debug 훅 노출
- [ ] vitest: `dedupeDownloadPath` 충돌 리네임(`foo.pdf`→`foo (1).pdf`→`foo (2).pdf`, 확장자 없는 파일) 순수 로직
- [ ] tsc + npm test

## CP3. renderer 인라인 cid: 이미지 해석(prepareHtml/MessageCard)
- [ ] `mail.ts` 스토어: `fetchAttachmentImage(messageId, attachmentId): Promise<{dataUri}|{error}>` 액션(accountId 주입 + calendarReady 무관)
- [ ] `ThreadView.tsx` `prepareHtml(message, opts, inlineImages)` — sanitize 후 `img[src^="cid:"]` src를 `inlineImages`의 data URI로 치환
- [ ] `MessageCard` `inlineImages: Map<contentId, dataUri>` state — mount 시 `inline && image/*` 항목 병렬 fetch, 도착 순 갱신 → `useMemo` deps에 `inlineImages`
- [ ] ⚠️ remote-image 게이트(`allowImages`)와 분리 — cid는 게이팅 없이 자동 로드(CSP `img-src data:` 현행 유지)
- [ ] tsc + npm test

## CP4. renderer 첨부 스트립 + 썸네일 + 라이트박스
- [ ] `mail.ts` 스토어: `lightboxImage: {dataUri, filename}|null` + `openLightbox(img)`/`closeLightbox()` + `downloadAttachment(messageId, attachmentId, filename): Promise<void>`(성공/실패 토스트) + `ACCOUNT_SCOPED_RESET`에 `lightboxImage:null`
- [ ] `ThreadView.tsx` `AttachmentStrip` — `attachments.filter(a=>!a.inline)` 렌더, mimetype 아이콘 + 파일명 + 용량, 이미지 항목 썸네일 병렬 fetch, 항목 fetch 실패 시 인라인 에러 + 재시도, 다운로드 버튼
- [ ] `AttachmentStrip`을 `MessageCard`의 iframe 아래에 마운트
- [ ] `Lightbox.tsx` 신설 — 오버레이 템플릿(backdrop+Esc+stopPropagation), `s.lightboxImage`로 구동, `App.tsx`에 마운트(`<AgendaPanel/>` 인접)
- [ ] ⚠️ `useKeyboard.ts` modal guard 배열 + Esc-close 블록 **두 곳 모두**에 `lightboxImage !== null` 등록
- [ ] tsc + npm test
- [ ] 데모 수동 확인: 인라인 로고 렌더 · 스트립(PDF/JPEG) · 썸네일 클릭→라이트박스 · Esc · 다운로드 토스트

## CP5. E2E TC-ATT 전건 + 무회귀 (Goal 5~8)
- [ ] TC-ATT-A1~A2 (인라인 cid 렌더 `img[src^="data:"]`, 게이트 우회 자동 로드)
- [ ] TC-ATT-B1~B3 (비인라인 스트립 노출, 인라인 제외, 파일명/용량)
- [ ] TC-ATT-C1~C4 (썸네일 표시, 클릭→라이트박스, Esc 닫힘, 배경 단축키 차단)
- [ ] TC-ATT-D1~D2 (다운로드 클릭→저장 경로 토스트, 충돌 `(1)` 리네임)
- [ ] TC-ATT-E1~E2 (fetch 실패 주입 항목 단위 에러+나머지 정상, 다운로드 실패 토스트)
- [ ] TC-ATT-F1~F2 (vitest — extractAttachments · dedupeDownloadPath 순수 로직) · TC-ATT-G1~G2 (회귀 게이트)
- [ ] 기존 E2E 무회귀 재실행 ×2 결정적 — 0 FAIL + SKIP 집합 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}` 유지 + 총계 200+신규
- [ ] `/react-best-practices` 클린 + audit(/impeccable 미설치 시 F1 D14 선례대로 web-design-guidelines/실측 대체) + 최종 `/code-review low`
- [ ] TC/TODO/DEV_WORKFLOW/루트 TODO 갱신 + Obsidian 기록
