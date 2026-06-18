# CodexDock npm 배포 가이드

작성일: 2026-06-17

이 문서는 현재 CodexDock monorepo를 npm에 public package로 배포하는 절차를 정리한다.

## 1. 배포 대상

현재 npm에 올릴 대상은 `packages/` 아래 두 개 패키지다.

| 패키지 | npm name | 역할 | 배포 여부 |
| --- | --- | --- | --- |
| `packages/sdk` | `@codexdock/sdk` | host web app용 server-side SDK와 protocol schema | 배포 |
| `packages/cli` | `codexdock` | local worker CLI | 배포 |

배포하지 않는 대상:

- root package `codexdock-workspace`: workspace 관리용이며 `private: true`
- `apps/example-web`: 예제 앱이며 `private: true`
- `dist/`, `.next/`, `node_modules/`: gitignore 및 npm package 대상에서 제외

## 2. 현재 확인된 상태

2026-06-17 현재 확인 결과:

- GitHub repo: `https://github.com/tahooki/codexdock`
- npm CLI는 `tahooki` 계정으로 로그인됨: `npm whoami`가 `tahooki` 반환
- npm registry에는 아래 active package가 배포되어 있음:
  - `codexdock`
  - `@codexdock/sdk`
- 이전 구조의 `@codexdock/protocol`, `@codexdock/codex-adapter` package는 더 이상 새 version을 publish하지 않는다.
- 이전 배포는 browser/passkey 인증을 사용하는 tarball publish 방식으로 성공함

첫 배포 전에는 scoped package의 `E404`가 "아직 패키지가 없다"는 뜻일 수 있지만, `@codexdock` scope 자체를 내가 소유하거나 접근 가능한지는 별도로 확인해야 한다. 이미 한 번 publish가 성공한 뒤에는 `npm view <package> versions`와 `npm dist-tag ls <package>`로 현재 published version과 `latest` tag를 확인한다.

## 3. 배포 전 결정

### npm scope

권장안:

- SDK는 `@codexdock/sdk` scope로 유지
- CLI는 짧게 `codexdock` 유지

필요 조건:

- npm에서 `codexdock` organization 또는 scope를 소유해야 한다.
- scope를 만들 수 없다면 `@tahooki/codexdock-sdk`처럼 소유 가능한 scope로 바꾼다.

### public 배포

scoped package는 기본이 restricted일 수 있으므로 반드시 public access로 배포한다.

```bash
pnpm -r --filter "./packages/*" publish --access public
```

### 버전 정책

배포 version은 각 package의 `package.json`에서 읽는다. 마지막으로 성공한 npm publish는 registry에서 확인한다.

새 배포를 하려면 기존 npm version과 다른 version으로 올려야 한다. npm은 같은 package/version 재배포를 허용하지 않는다.

- 패치 배포: 현재 package version + `latest`
- 실험 배포: 현재 package version의 prerelease + `beta`

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

- `@codexdock/sdk`: `Server-side SDK and protocol schemas for routing app AI invocations to local CodexDock workers.`
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

브라우저/passkey 인증을 쓰는 계정이면 `npm publish --auth-type=web`으로 npm이 인증 URL을 출력한다. Mac에서는 보통 브라우저에서 npm 로그인 후 Touch ID/passkey/security key 인증을 완료하면 publish가 이어진다.

주의: `pnpm publish`는 `--auth-type=web` 옵션을 직접 받지 않는다. 아래 명령은 실패한다.

```bash
pnpm -r --filter "./packages/*" publish --access public --auth-type=web
# ERROR: Unknown option: 'auth-type'
```

브라우저 인증이 필요하면 `pnpm pack`으로 tarball을 만든 뒤 `npm publish <tarball> --auth-type=web`을 사용한다. 자세한 절차는 "권장 배포 순서"를 참고한다.

CI에서 배포할 경우 npm automation token 또는 granular access token을 GitHub Actions secret으로 넣는다. package settings가 token publish를 허용해야 하며, 2FA bypass 권한이 필요한 경우 token 생성 시 설정한다.

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
npm view @codexdock/sdk version
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
VERSION="$(node -p 'require("./packages/cli/package.json").version')"
tar -tzf "/tmp/codexdock-npm-pack/codexdock-${VERSION}.tgz"
```

확인할 것:

- `dist/index.js`가 들어있는가
- `dist/index.d.ts`가 들어있는가
- source map 포함 여부가 의도와 맞는가
- `node_modules`, `.next`, local cache, secret 파일이 들어가지 않는가
- CLI package tarball에 executable bit가 유지되는가

## 6. 권장 배포 순서

이 repo는 pnpm workspace를 사용하고 package 간 의존성이 `workspace:*`로 연결되어 있다. `npm publish`를 package 폴더에서 직접 실행하면 `workspace:*` 처리 문제가 생길 수 있다.

기본 원칙:

- 빌드/검증/pack은 `pnpm`으로 한다.
- `pnpm pack`은 tarball 안의 `workspace:*` dependency를 실제 version으로 변환한다.
- 브라우저/passkey 인증이 필요하면 publish는 `npm publish <tarball> --auth-type=web`으로 한다.
- `pnpm publish --auth-type=web`은 지원되지 않는다.

권장 순서:

```bash
git status -sb
pnpm install
pnpm check
pnpm build
pnpm qa:smoke

rm -rf /tmp/codexdock-npm-pack
mkdir -p /tmp/codexdock-npm-pack
pnpm -r --filter "./packages/*" pack --pack-destination /tmp/codexdock-npm-pack
```

tarball 안의 package metadata를 확인한다.

```bash
for tgz in /tmp/codexdock-npm-pack/*.tgz; do
  echo "--- $(basename "$tgz")"
  tar -xOf "$tgz" package/package.json \
    | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const p=JSON.parse(s); console.log(JSON.stringify({name:p.name,version:p.version,dependencies:p.dependencies,bin:p.bin},null,2));})'
done
```

확인할 것:

- 모든 package version이 배포하려는 version인가
- `codexdock` tarball 안의 `@codexdock/sdk` workspace dependency가 실제 version으로 변환되었는가
- CLI tarball에 `bin.codexdock`가 있는가

### 6.1 Browser/passkey 인증으로 publish

`pnpm -r publish --auth-type=web`은 실패하므로, 생성된 tarball을 dependency 순서대로 `npm publish`한다.

```bash
VERSION="$(node -p 'require("./packages/cli/package.json").version')"

npm publish "/tmp/codexdock-npm-pack/codexdock-sdk-${VERSION}.tgz" \
  --access public \
  --auth-type=web

npm publish "/tmp/codexdock-npm-pack/codexdock-${VERSION}.tgz" \
  --access public \
  --auth-type=web
```

첫 package publish에서 다음과 같은 URL이 출력된다.

```text
Authenticate your account at:
https://www.npmjs.com/auth/cli/...
Press ENTER to open in the browser...
```

터미널에서 Enter를 눌러 브라우저를 열고 npm 페이지에서 Touch ID/passkey/security key 인증을 완료한다. 인증이 성공하면 해당 publish가 이어진다. 같은 로그인 세션이 살아 있으면 나머지 package는 추가 인증 없이 이어질 수 있다.

### 6.2 Token으로 publish

token을 쓸 경우 채팅/로그에 직접 노출하지 않는다. 로컬 임시 userconfig 또는 CI secret으로만 넣는다.

```bash
tmp_npmrc="$(mktemp)"
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$tmp_npmrc"

VERSION="$(node -p 'require("./packages/cli/package.json").version')"

npm publish "/tmp/codexdock-npm-pack/codexdock-sdk-${VERSION}.tgz" \
  --access public \
  --userconfig "$tmp_npmrc"

rm -f "$tmp_npmrc"
```

token publish가 실패하면서 2FA 관련 403이 나오면 token 권한 또는 package publishing access 설정을 확인한다.

### 6.3 pnpm publish 방식

OTP 또는 token 환경이 `pnpm publish`와 잘 맞는 경우에는 recursive publish도 가능하다.

```bash
pnpm -r --filter "./packages/*" publish --access public --dry-run --no-git-checks
pnpm -r --filter "./packages/*" publish --access public --no-git-checks
```

단, browser/passkey 인증이 필요한 상황에서는 위 방식 대신 tarball + `npm publish --auth-type=web` 방식을 사용한다.

beta tag로 먼저 배포:

```bash
pnpm -r --filter "./packages/*" publish --access public --tag beta --dry-run
pnpm -r --filter "./packages/*" publish --access public --tag beta
```

수동으로 하나씩 배포해야 한다면 dependency 순서를 지킨다: `@codexdock/sdk` -> `codexdock`.

## 7. 배포 후 검증

새 임시 폴더에서 consumer 관점으로 설치 테스트를 한다.

```bash
mkdir -p /tmp/codexdock-npm-test
cd /tmp/codexdock-npm-test
pnpm init
pnpm add @codexdock/sdk codexdock
pnpm exec codexdock doctor
```

package metadata 확인:

```bash
npm view codexdock version
npm view @codexdock/sdk version
```

CLI 실행 확인:

```bash
pnpm dlx codexdock doctor
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
- browser/passkey 인증이 필요한 개인 계정 publish 흐름은 GitHub Actions에 맞지 않으므로 token publish 권한을 먼저 검증

## 9. 현재 상태와 다음 작업

- [x] npm 로그인 확인
- [x] `@codexdock/*` scoped packages publish 가능 확인
- [x] `codexdock` unscoped CLI package publish 가능 확인
- [x] 각 package `description`, `license`, `repository`, `publishConfig`, `files` 추가
- [x] package별 README 작성
- [x] `pnpm -r --filter "./packages/*" publish --dry-run --access public --no-git-checks` 실행
- [x] browser/passkey 인증으로 이전 publish 완료
- [x] consumer 실행 확인은 `pnpm dlx codexdock@<version> doctor`로 수행
- [x] package version은 publish 전 bump한다
- [x] publish 후 registry와 consumer smoke로 검증한다
- [ ] token 기반 publish를 사용할 경우 token 권한과 2FA bypass 설정 검증
- [ ] GitHub Actions 자동 배포를 붙일 경우 `NPM_TOKEN` secret으로 dry run 후 적용
