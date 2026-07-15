# 첨부파일 표시·다운로드 (attachments) — 설계 스펙

> 2026-07-15 브레인스토밍 확정. post-roadmap(F1~F6 완주 이후) 신규 feature.
> 사용자 확정: 범위=**본문 인라인 이미지(cid:)까지**, 첨부목록 이미지=**썸네일 미리보기**, 다운로드=**바로 다운로드 폴더로 저장(Save-As 다이얼로그 없음)**.

## 목적

이메일에 첨부된 이미지·파일이 ZenMail에서 보이지 않고(본문 인라인 이미지는 깨진 채로 렌더링, 일반 첨부파일은 아예 UI에 노출되지 않음) 다운로드도 불가능한 상태다. Gmail API는 이미 첨부 메타데이터를 `format: 'full'` 응답에 포함해 보내주지만, `extractBodies()`가 이를 전부 버리고 있다(버그가 아니라 애초에 첨부를 다루지 않던 범위 밖 상태). 이번 feature로:

1. **본문 인라인 이미지** — 서명 로고 등 `cid:` 참조 이미지가 실제로 렌더링됨.
2. **첨부파일 목록** — 메시지 본문 아래 첨부파일 스트립(아이콘/썸네일 + 파일명 + 용량).
3. **다운로드** — 클릭 시 OS 다운로드 폴더로 즉시 저장(다이얼로그 없음, 파일명 충돌 시 안전하게 리네임).

## 범위 밖 (명시)

- Save-As 다이얼로그(경로 선택) — 매번 다운로드 폴더 고정.
- 첨부파일 바이트의 영속 캐시(sqlite) — 매 요청 fresh fetch, in-memory(세션 한정)만.
- 25MB 초과 등 대용량 스트리밍/청크 다운로드 — Gmail 자체 첨부 상한(25MB/메시지) 내에서 단순 처리.
- Compose에서 파일 첨부해서 보내기(발신 측 첨부) — 이번 feature는 수신 메일 표시·다운로드만.
- `cid:` 외 다른 인라인 참조 방식(예: `data:` URI로 이미 인라인된 경우는 그대로 통과, 별도 처리 불요).

## 아키텍처

기존 calendar-integration의 "GmailProvider 확장 + 4파일 IPC 규약" 패턴을 그대로 따른다.

### `src/main/gmail.ts` 확장

- `extractBodies()`의 MIME 재귀 walk에 attachment 수집을 추가(칼렌더 feature가 `text/calendar` 파트를 추가했던 것과 동일한 위치·기법). `filename`이 있거나 `body.attachmentId`가 있는 파트를 다음으로 매핑:

  ```ts
  interface AttachmentInfo {
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId?: string;   // 'Content-ID' 헤더, inline 이미지에만 존재
    inline: boolean;      // Content-Disposition: inline && contentId 존재
  }
  ```

- `GmailProvider` 인터페이스에 메서드 추가:

  ```ts
  getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string }>
  ```

  - `RealGmailProvider`: `gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })` → `data`는 Gmail이 반환하는 base64url을 그대로 전달(렌더러에서 data URI로 변환).
  - `MockGmailProvider`: 데모 시드에 첨부 fixture 2~3건(인라인 서명 로고 PNG 1건, 일반 첨부 PDF 1건 + JPEG 1건)을 `attachmentId → {data, mimeType}` 맵으로 두고 조회.

### `src/shared/types.ts`

- `AttachmentInfo` 타입 신설(위 정의).
- `MessageDetail.attachments?: AttachmentInfo[]` 추가(`invite?: InviteInfo`와 동일한 optional 패턴 — 없으면 그냥 미노출).
- `ZenmailApi`에 추가:

  ```ts
  getAttachmentImage(accountId, messageId, attachmentId): Promise<{ dataUri: string; mimeType: string } | { error: string }>
  downloadAttachment(accountId, messageId, attachmentId, filename): Promise<{ savedPath: string } | { error: string }>
  ```

### `src/main/ipc.ts`

- `mail:get-attachment-image` — provider.getAttachment 호출 후 `data:${mimeType};base64,${data}` 형태의 data URI로 변환해 반환. **이미지 mimetype 첨부에만 사용**(인라인 cid 렌더링 + 첨부 목록 썸네일). 실패 시 `{ error }` (throw 없이 renderer가 개별 아이템 에러 상태로 처리).
- `mail:download-attachment` — provider.getAttachment → base64 디코드 → `app.getPath('downloads')`에 파일명 충돌 시 `foo.pdf` → `foo (1).pdf` 형식으로 안전하게 리네임 후 `fs.writeFile`. 성공 시 `{ savedPath }`.
- 두 핸들러 모두 **첨부파일 바이트를 sqlite에 저장하지 않음** — 매 호출 fresh fetch(F6 sync-engine의 "메타데이터는 로컬 우선 캐시, 바이트는 캐시 제외" 원칙과 일관).
- `src/main/preload.ts`에 두 메서드 노출.

## UI (renderer)

### 인라인 이미지 (`ThreadView.tsx` — `prepareHtml`/`MessageCard`)

- `MessageCard`에 `inlineImages: Map<contentId, dataUri>` 상태 추가. mount 시 `message.attachments`에서 `inline && mimeType.startsWith('image/')`인 항목만 골라 `getAttachmentImage`를 병렬 호출, 도착하는 대로 state 갱신 → `srcDoc` 재계산(`useMemo` deps에 `inlineImages` 추가).
- `prepareHtml()`에서 sanitize 단계 이후, `img[src^="cid:"]`를 순회하며 `inlineImages`에 대응 데이터가 있으면 `src`를 data URI로 치환. 아직 도착 전이면 빈 상태(alt 텍스트만) 유지 — 로딩 스피너 등 추가 UI 불요(첨부 크기가 작고 로컬 IPC라 체감 지연 거의 없음, YAGNI).
- **기존 remote-image 게이트(`allowImages`/"Load remote images" 버튼)와 분리**: `cid:` 바이트는 사용자 본인 Gmail 계정에서 OAuth로 가져오는 데이터이지 제3자 트래킹 픽셀이 아니므로 게이팅 없이 항상 자동 로드.

### 첨부파일 스트립 (`ThreadView.tsx` 신설 `AttachmentStrip`)

- `MessageCard` 본문(iframe) 아래, `message.attachments.filter(a => !a.inline)` 렌더링 — inline이면서 실제로 body에 cid 참조되는 이미지는 스트립에서 제외(중복 노출 방지, Gmail/Apple Mail과 동일 관례).
- 항목별: mimetype 기반 아이콘(이미지/PDF/문서/압축/기타), 파일명, 용량(KB/MB 포맷).
- 이미지 mimetype 항목은 썸네일(`getAttachmentImage` 지연 호출, 스트립 마운트 시 병렬 fetch — 개수가 적어 상시 fetch, lazy-on-scroll 불요)을 작은 썸네일로 표시, 클릭 시 라이트박스(모달 오버레이, 기존 SnoozePicker/AgendaPanel 오버레이 템플릿 재사용 — backdrop+Esc+stopPropagation)로 확대.
- 모든 항목에 다운로드 버튼 — 클릭 시 `downloadAttachment` 호출, 성공 시 토스트("다운로드 완료 · ~/Downloads/foo.pdf"), 실패 시 에러 토스트.
- 첨부 fetch(썸네일/인라인) 실패는 항목 단위 인라인 에러 표시("불러오기 실패" 아이콘)로 격리 — 메시지 카드 전체가 깨지지 않음.

## 에러·오프라인 정책

- 썸네일/인라인 이미지 fetch 실패: 항목 단위 실패 아이콘, 재시도 버튼(수동 재요청) — 자동 재시도 없음(v1 단순화, calendar-integration의 "뮤테이션 큐 비대상 → 즉시 실패 처리" 방침과 동일 결).
- 다운로드 실패(디스크 쓰기 실패·attachment 만료 등): 토스트로 에러 메시지만, 모달 없음.
- 오프라인 상태에서 첨부 열람/다운로드 시도: 기존 IPC 실패 경로 그대로 통과(F6 큐 대상 아님 — 첨부는 읽기 전용 원격 데이터라 로컬 낙관 처리 불필요).

## 데모 모드 & E2E

- `MockGmailProvider` 시드에 첨부 포함 메시지 1~2통 추가: (a) 인라인 서명 로고(작은 PNG fixture, `Content-Disposition: inline`+`Content-ID`), (b) 일반 첨부 PDF 1건 + JPEG 1건(`Content-Disposition: attachment`).
- `__debug` 훅(기존 `--zenmail-e2e` 게이트)에 첨부 fetch 실패 주입 옵션 추가(TC-ATT 에러 케이스용).
- E2E 검증 대상(TC-ATT-*):
  - 인라인 cid 이미지가 깨지지 않고 렌더링(`img[src^="data:"]`로 치환 확인).
  - 비인라인 첨부가 스트립에 파일명/용량과 함께 노출, 인라인 항목은 스트립에서 제외.
  - 이미지 첨부 썸네일 표시 + 클릭 시 라이트박스 오픈/Esc 닫힘 + 배경 단축키 차단.
  - 다운로드 클릭 → 저장 경로 토스트 노출(모킹된 다운로드 폴더 확인) + 파일명 충돌 시 `(1)` 리네임.
  - 첨부 fetch 실패 주입 시 항목 단위 에러 표시, 나머지 메시지 카드 정상 동작(회귀 없음).

## 프로세스

DEV_WORKFLOW Goal 0~8 준수: 이 스펙 승인 → feature PRD(`docs/features/attachments/PRD.md`) → checkpoint TODO → If-When-Then TC → DECISIONS(인라인/목록 분리 기준, 바이트 무캐시, 이미지만 eager fetch 등) → react-best-practices → audit → E2E 전부 통과 → Obsidian 기록.
