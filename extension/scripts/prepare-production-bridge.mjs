/** 공식 Dashboard Item ID 확인 후에만 실행하는 로컬 빌드. 배포하지 않는다. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const id = process.argv[2] ?? ''
const knownLocal = ['pkagnijdhfmkodpdfgdehfdghcgbfpoa', 'mfijienedkbogcldkjfjjmgbfkfidocb']
if (!/^[a-p]{32}$/.test(id) || knownLocal.includes(id)) {
  throw new Error(
    'Dashboard에서 확인한 공식 Item ID 한 개가 필요합니다. 개발/로컬 ID는 금지합니다.',
  )
}
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = 'node_modules/.tmp/cws-production-bridge'
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_BRIDGE_EXTENSION_IDS: id, VITE_BRIDGE_DEV_BUILD: '' },
  },
)
if (result.status !== 0) process.exit(result.status ?? 1)
const headers = readFileSync(join(root, output, '_headers'), 'utf8')
const expected = `Content-Security-Policy: frame-ancestors chrome-extension://${id}`
if (headers.split(expected).length !== 3 || headers.includes('*')) {
  throw new Error('두 bridge 경로의 단일 ID CSP 검증 실패')
}
const html = readFileSync(join(root, output, 'bridge.html'), 'utf8')
const bridgeAsset = html.match(/src="(\/assets\/bridge-[^"]+\.js)"/)?.[1]
if (!bridgeAsset || !readFileSync(join(root, output, bridgeAsset), 'utf8').includes(id)) {
  throw new Error('브리지 JS의 공식 ID 반영 검증 실패')
}
console.log(`로컬 후보만 생성: ${output}. 공식 ID: ${id}. 배포 전 검토 및 사용자 승인 필요.`)
