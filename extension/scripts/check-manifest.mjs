// 빌드 산출물(dist/)의 manifest 와 파일을 검사한다 — `npm run check:manifest`.
//
// 기준: docs/architecture/EXTENSION_DESIGN.md §7 (권한·보안 정책), ADR 0023 결정 6.
// 이 검사는 Chrome 이 manifest 를 받아들이는지까지 보장하지 않는다. 실제 로드는
// Chromium 에서 따로 확인한다 (IMPLEMENTATION_PLAN.md M10-2).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')

/** 이 단계(M10-2)에서 허용하는 권한. 늘리려면 ADR 과 이 목록을 함께 바꾼다. */
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting']

/** 두지 않기로 한 키 (EXTENSION_DESIGN.md §7). */
const FORBIDDEN_KEYS = [
  'host_permissions',
  'optional_host_permissions',
  'content_scripts',
  'externally_connectable',
  'web_accessible_resources',
  'content_security_policy',
  'oauth2',
  'update_url',
]

const failures = []
const fail = (message) => failures.push(message)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${relative(root, path)} 를 읽지 못했다: ${error.message}`)
    return null
  }
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

/** manifest 가 가리키는 경로가 dist 안의 실제 파일인지. */
function expectFile(label, path) {
  if (typeof path !== 'string' || path === '') {
    fail(`${label}: 경로가 없다`)
    return
  }
  if (path.startsWith('/') || path.includes('..') || /^[a-z]+:/i.test(path)) {
    fail(`${label}: 확장 안의 상대 경로가 아니다 — ${path}`)
    return
  }
  if (!existsSync(join(dist, path))) fail(`${label}: dist/${path} 가 없다`)
}

if (!existsSync(dist)) {
  console.error('dist/ 가 없다 — 먼저 빌드한다 (npm run build-only)')
  process.exit(1)
}

const manifest = readJson(join(dist, 'manifest.json'))
const pkg = readJson(join(root, 'package.json'))

if (manifest !== null) {
  if (manifest.manifest_version !== 3) fail('manifest_version 이 3 이 아니다')

  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') fail('name 이 없다')
  if (typeof manifest.description !== 'string' || manifest.description.length > 132)
    fail('description 이 없거나 132자를 넘는다')

  const version = manifest.version
  const versionOk =
    typeof version === 'string' &&
    /^\d+(\.\d+){0,3}$/.test(version) &&
    version.split('.').every((part) => Number(part) <= 65535 && !/^0\d/.test(part))
  if (!versionOk) fail(`version 형식이 아니다 — ${version}`)
  if (pkg !== null && version !== pkg.version)
    fail(`manifest version(${version}) 과 package.json version(${pkg.version}) 이 다르다`)

  const permissions = manifest.permissions ?? []
  if (!Array.isArray(permissions)) fail('permissions 가 배열이 아니다')
  else {
    for (const permission of permissions) {
      if (!ALLOWED_PERMISSIONS.includes(permission)) fail(`허용하지 않은 권한 — ${permission}`)
    }
    if (new Set(permissions).size !== permissions.length) fail('permissions 에 중복이 있다')
  }

  for (const key of FORBIDDEN_KEYS) {
    if (key in manifest) fail(`두지 않기로 한 키가 있다 — ${key}`)
  }

  const background = manifest.background
  if (background === undefined || typeof background !== 'object') fail('background 가 없다')
  else {
    expectFile('background.service_worker', background.service_worker)
    if (background.type !== 'module') fail('background.type 이 module 이 아니다')
    if ('scripts' in background || 'page' in background) fail('MV2 형식의 background 키가 있다')
  }

  expectFile('action.default_popup', manifest.action?.default_popup)
}

// content script 는 executeScript({ files }) 로 주입하는 고전 스크립트여야 한다.
const contentPath = join(dist, 'content.js')
if (!existsSync(contentPath)) fail('content.js 가 없다')
else {
  const content = readFileSync(contentPath, 'utf8')
  if (/^\s*(import|export)\b/m.test(content)) fail('content.js 에 import/export 문이 남았다')
  if (/\bimport\s*\(/.test(content)) fail('content.js 에 동적 import 가 있다')
}

if (existsSync(dist)) {
  const files = listFiles(dist)
  for (const file of files) {
    const name = relative(dist, file)
    if (name.endsWith('.map')) fail(`소스맵이 들어 있다 — ${name}`)

    if (name.endsWith('.html')) {
      const html = readFileSync(file, 'utf8')
      // 확장 페이지 CSP 는 인라인 스크립트와 원격 스크립트를 막는다.
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
        if (!/\bsrc=/.test(tag)) fail(`${name}: 인라인 <script> 가 있다`)
        if (/\bsrc=["']?(https?:)?\/\//i.test(tag)) fail(`${name}: 원격 스크립트가 있다`)
      }
      if (/<link\b[^>]*href=["']?(https?:)?\/\//i.test(html)) fail(`${name}: 원격 리소스가 있다`)
    }

    if (name.endsWith('.js')) {
      const js = readFileSync(file, 'utf8')
      if (/\beval\s*\(/.test(js)) fail(`${name}: eval 이 있다`)
      if (/\bnew\s+Function\s*\(/.test(js)) fail(`${name}: new Function 이 있다`)
      if (/\bfetch\s*\(/.test(js))
        fail(`${name}: fetch 가 있다 — 확장은 네트워크 요청을 하지 않는다`)
    }
  }
  console.log(`dist 파일 ${files.length}개 검사`)
}

if (failures.length > 0) {
  console.error(`manifest 검사 실패 ${failures.length}건`)
  for (const message of failures) console.error(`  ✖ ${message}`)
  process.exit(1)
}

console.log(
  `manifest 검사 통과 — MV3 · 권한 [${(manifest?.permissions ?? []).join(', ')}] · 금지 키 없음 · 참조 파일 존재`,
)
