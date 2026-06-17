# CodexDock npm 배포 가이드

작성일: 2026-06-17

이 문서는 현재 CodexDock monorepo를 npm에 public package로 배포하는 절차를 정리한다.

## 1. 배포 대상

현재 npm에 올릴 대상은 `packages/` 아래 네 개 패키지다.

| 패키지 | npm name | 역할 | 배포 여부 |
| --- | --- | --- | --- |
| `packages/protocol` | `@codexdock/protocol` | SDK/CLI 공통 protocol, zod schema | 배포 |
| `packages/sdk` | `@codexdock/sdk` | host web app용 server-side SDK | 배포 |
| `packages/codex-adapter` | `@codexdock/codex-adapter` | Codex SDK/fake adapter | 배포 |
| `packages/cli` | `codexdock` | local worker CLI | 배포 |

배포하지 않는 대상:

- root package `codexdock-workspace`: workspace 관리용이며 `private: true`
- `apps/example-web`: 예제 앱이며 `private: true`
- `dist/`, `.next/`, `node_modules/`: gitignore 및 npm package 대상에서 제외

## 2. 현재 확인된 상태

2026-06-17 현재 확인 결과:

- GitHub repo: `https://github.com/tahooki/codexdock`
- npm CLI는 `tahooki` 계정으로 로그인됨: `npm whoami`가 `tahooki` 반환
- `@codexdock` npm org/scope는 아직 없음: `npm access list packages @codexdock --json`이 `Scope not found` 반환
- npm registry에서 아래 package name은 아직 조회되지 않음:
  - `codexdock`
  - `@codexdock/sdk`
  - `@codexdock/protocol`
  - `@codexdock/codex-adapter`

주의: scoped package의 `E404`는 "아직 패키지가 없다"는 뜻일 수 있지만, `@codexdock` scope 자체를 내가 소유하거나 접근 가능한지는 별도로 확인해야 한다. `@codexdock` npm organization/scope가 없다면 먼저 생성해야 하고, 이미 다른 사람이 소유한 scope라면 package 이름을 바꿔야 한다.

## 3. 배포 전 결정

### npm scope

권장안:

- SDK 계열은 `@codexdock/*` scope로 유지
- CLI는 짧게 `codexdock` 유지

필요 조건:

- npm에서 `codexdock` organization 또는 scope를 소유해야 한다.
- scope를 만들 수 없다면 `@tahooki/codexdock-sdk`, `@tahooki/codexdock-protocol`처럼 소유 가능한 scope로 바꾼다.

### public 배포

scoped package는 기본이 restricted일 수 있으므로 반드시 public access로 배포한다.

```bash
pnpm -r --filter "./packages/*" publish --access public
```

### 버전 정책

현재 모든 배포 대상 package version은 `0.1.0`이다.

초기 공개 테스트를 하고 싶으면 둘 중 하나를 선택한다.

- 정식 첫 배포: `0.1.0` + `latest`
- 실험 배포: `0.1.0-beta.0` + `beta`

beta로 먼저 올릴 경우:

```bash
pnpm -r --filter "./packages/*" publish --access public --tag beta
```

## 4. 배포 전 package.json 보강

실제 publish 전에 각 배포 package에 npm metadata를 추가하는 것이 좋다.

공통 권장 필드:

```json
{
  "description": "Short package description",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tahooki/codexdock.git",
    "directory": "packages/package-name"
  },
  "homepage": "https://github.com/tahooki/codexdock#readme",
  "bugs": {
    "url": "https://github.com/tahooki/codexdock/issues"
  },
  "publishConfig": {
    "access": "public"
  },
  "files": [
    "dist",
    "README.md",
    "package.json"
  ]
}
```

패키지별 설명 예시:

- `@codexdock/protocol`: `Shared protocol types and runtime schemas for CodexDock.`
- `@codexdock/sdk`: `Server-side SDK for routing app AI invocations to local CodexDock workers.`
- `@codexdock/codex-adapter`: `Codex SDK adapter layer for CodexDock workers.`
- `codexdock`: `CLI worker that connects host apps to a local Codex runtime.`

중요:

- `files`를 지정하지 않으면 예상보다 많은 파일이 npm tarball에 들어갈 수 있다.
- 각 package에 `README.md`가 없으면 npm package 페이지가 빈약해진다.
- `codexdock` CLI package의 `bin.codexdock`는 이미 `./dist/index.js`로 설정되어 있다.

## 5. 배포 전 체크리스트

### 1. npm 로그인

```bash
npm login
npm whoami
```

2FA가 켜져 있으면 publish 시 OTP가 필요하다.

```bash
pnpm -r --filter "./packages/*" publish --access public --otp 123456
```

CI에서 배포할 경우 npm automation token을 GitHub Actions secret으로 넣는다.

```text
NPM_TOKEN=...
```

### 2. scope 권한 확인

```bash
npm access ls-packages @codexdock
```

이 명령이 권한 오류를 내면 npm 웹에서 `codexdock` organization/scope를 만들거나 package name을 변경한다.

### 3. registry 이름 확인

```bash
npm view codexdock version
npm view @codexdock/protocol version
npm view @codexdock/sdk version
npm view @codexdock/codex-adapter version
```

`E404`면 아직 배포된 package가 없다는 뜻이다. 권한이 있는 scope라면 첫 publish가 가능하다.

### 4. build/check/smoke

```bash
pnpm install
pnpm check
pnpm build
pnpm qa:smoke
```

현재 `pnpm check`와 `pnpm build`는 통과한 상태다. publish 직전에는 `pnpm qa:smoke`까지 다시 돌린다.

### 5. package contents 확인

실제 publish 전에 tarball 내용을 확인한다.

```bash
rm -rf /tmp/codexdock-npm-pack
mkdir -p /tmp/codexdock-npm-pack
pnpm -r --filter "./packages/*" pack --pack-destination /tmp/codexdock-npm-pack
tar -tzf /tmp/codexdock-npm-pack/codexdock-0.1.0.tgz
```

확인할 것:

- `dist/index.js`가 들어있는가
- `dist/index.d.ts`가 들어있는가
- source map 포함 여부가 의도와 맞는가
- `node_modules`, `.next`, local cache, secret 파일이 들어가지 않는가
- CLI package tarball에 executable bit가 유지되는가

## 6. 권장 배포 순서

이 repo는 pnpm workspace를 사용하고 package 간 의존성이 `workspace:*`로 연결되어 있다. `npm publish`를 package 폴더에서 직접 실행하면 `workspace:*` 처리 문제가 생길 수 있으므로, 기본 배포 명령은 `pnpm publish -r`을 사용한다.

권장 순서:

```bash
git status -sb
pnpm install
pnpm check
pnpm build
pnpm qa:smoke
pnpm -r --filter "./packages/*" publish --access public --dry-run
pnpm -r --filter "./packages/*" publish --access public
```

beta tag로 먼저 배포:

```bash
pnpm -r --filter "./packages/*" publish --access public --tag beta --dry-run
pnpm -r --filter "./packages/*" publish --access public --tag beta
```

수동으로 하나씩 배포해야 한다면 dependency 순서를 지킨다.

```bash
pnpm --filter @codexdock/protocol publish --access public
pnpm --filter @codexdock/sdk publish --access public
pnpm --filter @codexdock/codex-adapter publish --access public
pnpm --filter codexdock publish --access public
```

## 7. 배포 후 검증

새 임시 폴더에서 consumer 관점으로 설치 테스트를 한다.

```bash
mkdir -p /tmp/codexdock-npm-test
cd /tmp/codexdock-npm-test
pnpm init
pnpm add @codexdock/sdk codexdock
pnpm exec codexdock doctor --adapter fake
```

실제 Codex SDK adapter까지 확인:

```bash
pnpm exec codexdock doctor --adapter sdk
```

package metadata 확인:

```bash
npm view codexdock version
npm view @codexdock/sdk version
npm view @codexdock/protocol version
npm view @codexdock/codex-adapter version
```

CLI 실행 확인:

```bash
pnpm dlx codexdock doctor --adapter fake
```

## 8. GitHub Actions 자동 배포 초안

초기에는 수동 publish를 권장한다. npm scope/권한/name 문제가 해결된 뒤 자동화를 붙인다.

`.github/workflows/publish.yml` 예시:

```yaml
name: Publish packages

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "npm dist tag"
        required: true
        default: "latest"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.24.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: "https://registry.npmjs.org"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm build
      - run: pnpm qa:smoke
      - run: pnpm -r --filter "./packages/*" publish --access public --tag "${{ github.event.inputs.tag }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

자동 배포 전제:

- GitHub repo secret `NPM_TOKEN` 등록
- npm token은 publish 권한이 있는 automation token 사용
- package metadata와 `files` 설정 완료
- 첫 수동 배포로 scope 권한과 package name을 검증

## 9. 현재 남은 작업

- [ ] npm 로그인 또는 automation token 준비
- [ ] `@codexdock` npm scope 소유/생성 확인
- [ ] 각 package `description`, `license`, `repository`, `publishConfig`, `files` 추가
- [ ] package별 README 작성
- [ ] `pnpm -r --filter "./packages/*" publish --dry-run --access public` 실행
- [ ] 첫 publish는 가능하면 `--tag beta`로 검증
- [ ] consumer 임시 프로젝트에서 설치/CLI 실행 확인
