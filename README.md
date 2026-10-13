# AutoNai personal

NovelAI 이미지 페이지(`https://novelai.net/image`)에서 반복 생성을 실행하는 개인용 Chrome Manifest V3 확장프로그램입니다.

현재 버전은 **v0.3.8**입니다. 프롬프트 관리·선택·편집·슬롯 적용·가져오기·내보내기 기능과 관련 코드 및 테스트를 제거했습니다. NovelAI 페이지에서 설정한 프롬프트와 생성 옵션으로 반복 생성합니다.

저장소: [StopOverthinking/AutoNai-personal](https://github.com/StopOverthinking/AutoNai-personal)

## 기능

- 3·5·10·20회 반복 생성, 매 생성 완료 후 1초 대기
- 시작·중지 버튼과 진행 횟수 표시
- 드래그 또는 이동 핸들의 방향키로 패널 이동, 위치 저장
- 이번 반복 생성 결과의 히스토리에 청록색 테두리와 모서리 표시
  - 1~4장 묶음의 생성 그룹을 구분하며 과거 항목이나 중복 표시를 새 결과로 계산하지 않음
  - 재렌더링·히스토리 재표시 후에도 생성 그룹 ID를 기준으로 강조 복원
  - 중지 당시 진행 중이던 생성의 늦은 결과도 강조
  - 다음 수동·반복 생성 또는 페이지 이탈 시 이전 강조 해제
- 목표 횟수 완료 시 화면 중앙에 완료 오버레이 표시
  - 확인 버튼, Esc 또는 배경 클릭으로 닫기
  - 중지·오류·시간 초과에는 표시하지 않음
- 목표 횟수 완료 시 브라우저 알림 한 번 표시
  - 확장 팝업의 `완료 알림` 체크박스로 켜기/끄기 (기본값: 켜짐)
  - 기존 완료 알림 설정 유지, 다른 탭을 보고 있어도 알림 요청
  - Chrome 및 운영체제의 알림 설정에 따라 실제 표시 여부가 달라짐
- `Ctrl + Enter`: 시작 / `Ctrl + Alt + Enter`: 중지
- 생성 버튼의 상태 변화, 새 히스토리 결과, 버튼 교체·재등장 및 탭 재개를 감지해 중복 요청 방지
  - 시작 신호가 늦어도 중복 클릭 없이 최대 10분 동안 확인
  - 준비 상태가 0.3초 유지되는지 확인한 뒤 완료 처리

## 설치·업데이트

1. 이 저장소를 내려받거나 `output/AutoNai-personal-v0.3.8.zip`을 압축 해제합니다.
2. Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드**를 눌러 `manifest.json`이 있는 폴더를 선택합니다.
4. NovelAI 이미지 페이지를 새로고침합니다.

기존 설치를 업데이트했다면 Chrome 확장 관리 화면에서 확장을 새로고침한 뒤 NovelAI 페이지도 새로고침하세요. `manifest.json`의 기존 `key`를 유지하므로 이름 변경 후에도 확장 ID와 반복 생성 설정을 이어받습니다.

## 검증

Node.js/npm과 PowerShell이 필요합니다. 브라우저 검증에는 `@playwright/cli`를 사용합니다.

```powershell
node --check content.js
node --check background.js
node --check popup/popup.js
node tests/completion-notification.test.js
pwsh -File tests/browser-checks.ps1
```

`tests/browser/`에 반복 생성·완료 알림·팝업·히스토리 회귀 검증 스크립트가 있습니다. 생성 검증은 요청을 가로채는 로컬 브라우저 시뮬레이션으로 수행하며 실제 이미지 생성 요청을 보내지 않습니다. `pwsh -File tests/browser-checks.ps1 -IncludeLiveSite`로 별도의 `live-ui` 검증도 실행할 수 있습니다. 실제 NovelAI 페이지의 데스크톱·모바일 생성 버튼 감지만 확인하며 생성 요청을 차단합니다.

로그·화면·배포 ZIP은 `output/`에 저장하고 Git에 포함하지 않습니다.
