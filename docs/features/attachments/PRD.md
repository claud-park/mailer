# attachments — Feature PRD

> 2026-07-15 · Goal 1 산출물. 설계: 브레인스토밍 확정([설계 스펙](../../superpowers/specs/2026-07-15-attachments-design.md)) — 사용자 확정: 범위=**본문 인라인 이미지(cid:)까지**, 첨부목록 이미지=**썸네일 미리보기(클릭 시 확대)**, 다운로드=**바로 다운로드 폴더로 저장(Save-As 다이얼로그 없음)**.
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · post-roadmap(F1~F6 완주 이후) 신규 feature.

## 1. 배경 / 목표

ZenMail은 이메일에 첨부된 이미지·파일을 전혀 다루지 못한다. 본문에 서명 로고 같은 인라인 이미지(`cid:` 참조)가 있으면 깨진 채로 렌더링되고, 일반 첨부파일(PDF·이미지 등)은 아예 UI에 노출되지 않으며 다운로드도 불가능하다. Gmail API는 이미 `threads.get({format:'full'})` 응답에 첨부 메타데이터(`filename`/`mimeType`/`body.attachmentId`/`body.size`, 인라인 파트의 `Content-ID` 헤더)를 포함해 보내주지만, `extractBodies()`가 `text/html`/`text/plain`/`text/calendar` 파트만 캡처하고 첨부 파트를 조용히 버리고 있다(버그가 아니라 애초에 첨부를 다루지 않던 범위 밖 상태).

이번 feature로 수신 메일의 첨부를 표시·다운로드한다:

1. **본문 인라인 이미지** — 서명 로고 등 `cid:` 참조 이미지가 실제로 렌더링된다.
2. **첨부파일 목록** — 메시지 본문 아래 첨부 스트립(아이콘/썸네일 + 파일명 + 용량).
3. **다운로드** — 클릭 시 OS 다운로드 폴더로 즉시 저장(다이얼로그 없음, 파일명 충돌 시 안전하게 리네임).

아키텍처는 calendar-integration의 "GmailProvider 확장 + 4-파일 IPC 규약" 패턴을 그대로 미러링한다. 첨부 바이트는 매 요청 fresh fetch(sqlite 영속 캐시 없음)이며, 인라인 이미지 fetch는 `MessageDetail.invite?`와 동일한 optional·fail-safe 패턴을 따른다.

## 2. 사용자 스토리

### US1. 본문 인라인 이미지
- 사용자로서, 서명에 로고 이미지가 박힌 메일을 열면 로고가 깨진 아이콘이 아니라 실제 이미지로 보이길 원한다.
- 사용자로서, 인라인 이미지는 내 Gmail 계정에서 OAuth로 가져온 내 데이터이므로 "이미지 불러오기" 버튼을 누르지 않아도 자동으로 표시되길 원한다(제3자 트래킹 픽셀과 구분).

### US2. 첨부파일 목록
- 사용자로서, 첨부가 있는 메일을 열면 본문 아래에 첨부파일이 파일명·용량과 함께 나열되어 무엇이 왔는지 한눈에 확인하고 싶다.
- 사용자로서, 첨부가 이미지면 아이콘만이 아니라 작은 썸네일로 미리 보고, 클릭하면 크게 확대해서 보고 싶다.
- 사용자로서, 본문에 이미 인라인으로 박힌 이미지가 첨부 목록에 중복으로 또 뜨지 않길 원한다(Gmail/Apple Mail과 동일 관례).

### US3. 다운로드
- 사용자로서, 첨부파일의 다운로드 버튼을 누르면 저장 위치를 매번 고르는 다이얼로그 없이 바로 다운로드 폴더에 저장되길 원한다.
- 사용자로서, 같은 파일을 두 번 받아도 기존 파일을 덮어쓰지 않고 `foo (1).pdf`처럼 안전하게 별도 저장되길 원한다.
- 사용자로서, 다운로드가 어디에 저장됐는지 토스트로 알려주고, 실패하면 실패했다고 알려주길 원한다.

### US4. 에러 격리
- 사용자로서, 첨부 하나를 불러오지 못해도 메시지 카드 전체가 깨지지 않고 그 항목만 실패 표시되며, 재시도할 수 있길 원한다.

## 3. 기능 요구사항 (FR)

### 첨부 메타데이터 추출 & Provider
- **FR1**: `extractBodies()`의 MIME 재귀 walk를 확장해, `filename`이 있거나 `body.attachmentId`가 있는 파트를 `AttachmentInfo`로 수집한다(calendar가 `text/calendar` 파트를 추가한 것과 동일 위치·기법). 본문 파트(html/text/calendar)는 기존대로 별도 캡처한다.
- **FR2**: `AttachmentInfo` 타입을 신설하고, `MessageDetail.attachments?: AttachmentInfo[]`를 추가한다(`invite?: InviteInfo`와 동일한 optional·fail-safe 패턴 — 없으면 미노출).
- **FR3**: 인라인 판정 — 파트에 `Content-ID` 헤더가 있고 `Content-Disposition`이 `inline`이면 `inline: true` + `contentId` 설정. 그 외는 `inline: false`.
- **FR4**: `GmailProvider` 인터페이스에 `getAttachment(messageId, attachmentId): Promise<{ data: string; mimeType: string }>`를 추가한다. `RealGmailProvider`는 `gmail.users.messages.attachments.get`를 호출해 Gmail이 반환하는 base64url `data`를 그대로 전달한다. `MockGmailProvider`는 데모 첨부 fixture 바이트 맵(`attachmentId → { data, mimeType }`)에서 조회한다.

### IPC 4-파일 계약
- **FR5**: `mail:get-attachment-image` 핸들러 — `provider.getAttachment` 후 `data:${mimeType};base64,${data}` 형태의 data URI로 변환해 `{ dataUri, mimeType }` 반환. **이미지 mimetype 첨부에만 사용**(인라인 cid 렌더링 + 스트립 썸네일). 실패 시 throw 없이 `{ error }` 반환(렌더러가 항목 단위 에러로 처리).
- **FR6**: `mail:download-attachment` 핸들러 — `provider.getAttachment` → base64 디코드 → 다운로드 폴더(`app.getPath('downloads')`)에 파일명 충돌 시 `foo.pdf` → `foo (1).pdf` 형식으로 안전 리네임 후 `fs.promises.writeFile`. 성공 시 `{ savedPath }`, 실패 시 `{ error }`.
- **FR7**: 두 핸들러 모두 **첨부 바이트를 sqlite에 저장하지 않는다** — 매 호출 fresh fetch(in-memory·세션 한정만). F6 sync-engine의 "메타데이터는 로컬 우선 캐시, 바이트는 캐시 제외" 원칙과 일관.
- **FR8**: `types.ts`(`AttachmentInfo`/`MessageDetail.attachments`/`ZenmailApi` 2메서드) · `ipc.ts`(2핸들러) · `preload.ts`(2메서드 노출) · `gmail.ts`(provider 메서드)의 4-파일 계약으로 배선한다(accountId를 첫 인자로 하는 기존 IPC 관례 준수).

### 인라인 cid: 이미지 (renderer)
- **FR9**: `prepareHtml()`의 sanitize 단계 이후 `img[src^="cid:"]`를 순회하며, 대응하는 `inlineImages` 데이터가 있으면 `src`를 data URI로 치환한다. 아직 도착 전이면 빈 상태(alt 텍스트) 유지 — 로딩 스피너 불요(YAGNI).
- **FR10**: `MessageCard`는 mount 시 `message.attachments`에서 `inline && mimeType.startsWith('image/')`인 항목만 골라 `getAttachmentImage`를 병렬 호출하고, 도착하는 대로 `inlineImages: Map<contentId, dataUri>` state를 갱신해 `srcDoc`를 재계산한다(`useMemo` deps에 `inlineImages` 추가).
- **FR11**: **기존 remote-image 게이트(`allowImages`/"Load remote images")와 분리**한다. `cid:` 바이트는 사용자 본인 Gmail 계정에서 OAuth로 가져온 데이터이지 제3자 트래킹 픽셀이 아니므로 게이팅 없이 항상 자동 로드한다. iframe CSP의 `img-src`는 `data:`를 항상 허용하므로(현행 유지), cid 치환은 `allowImages` 상태와 무관하게 렌더된다.

### 첨부 스트립 & 썸네일 & 라이트박스 (renderer)
- **FR12**: `MessageCard` 본문(iframe) 아래에 `AttachmentStrip`을 렌더한다. `message.attachments.filter(a => !a.inline)`만 노출한다 — 인라인(본문 cid 참조) 이미지는 스트립에서 제외(중복 노출 방지).
- **FR13**: 각 항목은 mimetype 기반 아이콘(이미지/PDF/문서/압축/기타) + 파일명 + 용량(KB/MB 포맷)을 표시한다.
- **FR14**: 이미지 mimetype 항목은 스트립 마운트 시 `getAttachmentImage`를 병렬 fetch해 작은 썸네일로 표시한다(개수가 적어 상시 fetch, lazy-on-scroll 불요). 썸네일 클릭 시 라이트박스로 확대한다.
- **FR15**: 라이트박스는 store 상태(`lightboxImage`)로 구동되는 오버레이 모달로, 기존 SnoozePicker/AgendaPanel 오버레이 템플릿(backdrop `bg-black/50` + click-outside close, 패널 `onKeyDown` stopPropagation + Esc close)을 따른다. `useKeyboard.ts`의 modal guard 배열과 Esc-close 블록 두 곳 모두에 `lightboxImage !== null`을 등록해 배경 단축키 누수를 막는다.
- **FR16**: 모든 항목에 다운로드 버튼을 둔다 — 클릭 시 `downloadAttachment` 호출, 성공 시 토스트("다운로드 완료 · <savedPath>"), 실패 시 에러 토스트.

### 에러 · 오프라인 정책
- **FR17**: 썸네일/인라인 이미지 fetch 실패는 항목 단위 인라인 에러(실패 아이콘 + 재시도 버튼, 수동 재요청)로 격리한다 — 메시지 카드 전체가 깨지지 않는다. 자동 재시도 없음(v1 단순화, calendar D6의 "즉시 실패 처리" 방침과 동일 결).
- **FR18**: 다운로드 실패(디스크 쓰기 실패·attachment 만료 등)는 토스트로 에러 메시지만 표시한다(모달 없음). 오프라인 첨부 열람/다운로드는 기존 IPC 실패 경로 그대로 통과(F6 큐 비대상 — 첨부는 읽기 전용 원격 데이터).

### 데모 모드 & E2E 지원
- **FR19**: `buildDemoData()`에 첨부 포함 메시지 스레드 1건을 추가한다 — (a) 인라인 서명 로고 PNG(`Content-Disposition: inline` + `Content-ID`, 본문에서 `cid:` 참조), (b) 일반 첨부 PDF 1건, (c) 일반 첨부 JPEG 1건. `MockGmailProvider`는 이 fixture 바이트를 `attachmentId → { data, mimeType }` 맵으로 보유한다.
- **FR20**: 기존 `ZENMAIL_E2E_PORT`/`--zenmail-e2e` 게이트 안에 `__debug` 훅을 추가한다 — 첨부 fetch 실패 1회 주입(`__debugFailNextAttachment`), E2E 전용 다운로드 디렉터리 오버라이드(`__debugSetDownloadDir`, 실제 사용자 Downloads 오염 방지 + 저장 경로/충돌 리네임 검증). TC-ATT-* 지원용.

## 4. 비기능 요구사항 (NFR)

- **NFR1 (신규 npm 의존성 0)**: `gmail.users.messages.attachments.get`는 기존 `googleapis ^173`에 포함되어 있고, 파일 저장은 Node 표준 `node:fs`/electron `app`만 사용한다. `package.json`에 새 의존성을 추가하지 않는다.
- **NFR2 (No AI)**: v1 No AI 원칙(스펙 §9) 준수 — mimetype 아이콘 매핑·파일명 리네임·용량 포맷은 전부 결정적 규칙이며 AI 분석/썸네일 생성/OCR 등을 일체 포함하지 않는다.
- **NFR3 (프라이버시 경계 유지)**: 원격 `https:`/`http:` 이미지의 click-to-load 게이트(`allowImages`)는 그대로 유지한다. cid: 인라인 이미지만 게이트를 우회한다(본인 계정 데이터). 다른 사용자 프라이버시 동작을 변경하지 않는다.
- **NFR4 (바이트 무캐시)**: 첨부 바이트는 sqlite에 저장하지 않으며 매 요청 fresh fetch한다. 메타데이터(`AttachmentInfo`)는 `MessageDetail`의 일부로 기존 detail 캐시 경로를 그대로 탄다(별도 캐시 신설 없음).
- **NFR5 (키보드 중심)**: 라이트박스는 Esc로 닫히고 열려 있는 동안 배경 단축키를 차단해야 한다(기존 오버레이 템플릿 재사용).
- **NFR6 (데모 모드 동작)**: 실계정 OAuth 없이도 `MockGmailProvider` fixture로 인라인 이미지 렌더·썸네일·라이트박스·다운로드 4기능이 전부 데모에서 동작해야 한다.
- **NFR7 (아키텍처 일관성)**: getAttachment는 기존 `GmailProvider`(Real/Mock 이원화, 4-파일 IPC 계약, 기존 인증 재사용) 패턴을 그대로 미러링한다.
- **NFR8 (무회귀)**: 기존 E2E 캐논(multi-account 완료 시점 **200 PASS · 0 FAIL · 6 SKIP**, SKIP 집합 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`)이 그대로 유지되어야 한다(0 FAIL + 신규 SKIP 없음).

## 5. 범위 밖 (명시)

설계 스펙 §범위 밖 그대로:

- Save-As 다이얼로그(경로 선택) — 매번 다운로드 폴더 고정.
- 첨부 바이트의 영속 캐시(sqlite) — 매 요청 fresh fetch, in-memory(세션 한정)만.
- 25MB 초과 등 대용량 스트리밍/청크 다운로드 — Gmail 첨부 상한(25MB/메시지) 내 단순 처리.
- Compose에서 파일 첨부해서 보내기(발신 측 첨부) — 이번 feature는 수신 메일 표시·다운로드만.
- `cid:` 외 다른 인라인 참조 방식 — `data:` URI로 이미 인라인된 이미지는 그대로 통과(별도 처리 불요).
- 첨부 미리보기(PDF 뷰어 등) — 이미지 라이트박스 확대만. 그 외 mimetype은 아이콘 + 다운로드만.

## 6. 성공 기준

1. 인라인 서명 로고가 포함된 데모 메일을 열면 로고가 깨지지 않고 실제 이미지(`img[src^="data:"]`)로 렌더된다("이미지 불러오기" 버튼 없이 자동).
2. 첨부 스트립에 비인라인 첨부(PDF·JPEG)가 파일명·용량과 함께 노출되고, 인라인 로고는 스트립에서 제외된다.
3. 이미지 첨부 썸네일이 표시되고, 클릭 시 라이트박스가 열리며 Esc로 닫히고 열려 있는 동안 배경 단축키가 차단된다.
4. 다운로드 버튼 클릭 시 다운로드 폴더에 저장되고 저장 경로 토스트가 뜨며, 같은 파일 재다운로드 시 `(1)`로 리네임된다.
5. 첨부 fetch 실패 주입 시 해당 항목만 에러 표시되고 나머지 메시지 카드는 정상 동작한다.
6. 신규 TC-ATT-* E2E 전부 통과 + 기존 E2E 무회귀(200 PASS·0 FAIL·6 SKIP 유지, 신규 SKIP 없음) + vitest(extractAttachments·dedupeDownloadPath 순수 로직) + tsc.
