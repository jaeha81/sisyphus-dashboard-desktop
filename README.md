# Sisyphus Dashboard Desktop

**Windows 데스크탑 앱** — OpenCode 멀티 터미널 AI 코딩 대시보드

```
┌─────────┬──────────┬──────────┐
│ GitHub  │ PANEL 1  │ PANEL 2  │
│  Repos  │ opencode │ opencode │
│ 사이드바 ├──────────┼──────────┤
│         │ PANEL 3  │ PANEL 4  │
│         │ opencode │ opencode │
└─────────┴──────────┴──────────┘
```

## 요구 사항

- Windows 10/11 + **WSL2 Ubuntu**
- **Node.js v18+** (Windows 네이티브)
- **ttyd** (WSL2 Ubuntu에 설치)
- **OpenCode CLI** (WSL2 Ubuntu에 설치)

## 개발 모드 실행

```bat
dev-start.bat
```

또는:
```bat
npm install
npm start -- --dev
```

## Windows 인스톨러 빌드

```bat
build-win.bat
```

빌드 결과물: `dist/SisyphusDashboard Setup 1.0.0.exe`

## 플러그인 시스템

### 플러그인 설치

앱 내 **🔌 플러그인** 버튼 → GitHub URL 입력:
```
https://github.com/user/sisyphus-plugin-name
```

### 플러그인 개발

`plugins/` 폴더에 새 디렉토리를 만들고 다음 파일을 작성:

**`plugin.json`**:
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "설명",
  "main": "index.js"
}
```

**`index.js`**:
```javascript
module.exports = {
  registerRoutes(router) {
    router.get('/api/plugin/my-plugin/data', async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
    });
  },
  getUICode() {
    return {
      html: '<div id="my-root">Loading...</div>',
      js: '(function(el){ el.textContent = "Hello Plugin!"; })(el);',
    };
  },
};
```

### 기본 제공 플러그인

| 플러그인 | 기능 |
|---------|------|
| `git-status` | Git 브랜치, 변경 파일, 커밋 상태 표시 |
| `system-monitor` | CPU, 메모리, 디스크 사용량 모니터링 |

## 환경 설정

`.env.local.example`을 `.env.local`로 복사 후 편집:

```env
GITHUB_TOKEN=ghp_your_token_here
REPOS_BASE=/mnt/c/ai프로젝트,/mnt/c/ai관리대시보드
CLONE_BASE=/mnt/c/ai프로젝트
```

## 기존 대시보드와의 차이

| 항목 | 웹 대시보드 | 데스크탑 앱 |
|------|-----------|------------|
| 실행 방식 | WSL2 내 Node.js + 브라우저 | Windows EXE + Electron |
| 설치 | `bash install.sh` | `.exe` 더블클릭 |
| 시스템 트레이 | ✗ | ✓ |
| 플러그인 | ✗ | ✓ |
| 네이티브 파일 다이얼로그 | ✗ | ✓ |
| 단일 인스턴스 보장 | ✗ | ✓ |
| 자동 업데이트 | `git pull` | (추후 플러그인으로 추가 가능) |
