// M11-7A 시안의 토큰 · 데크 SVG 를 실제 앱 소스에서 옮겨 적는다 (한 번 실행해 결과를 커밋한다 — 시안은 앱을 따라가지 않는다).
//   node gen-assets.mjs <repo>
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repo = process.argv[2]
const out = path.join(repo, 'design/mockups/m11-7a')
const read = (p) => readFileSync(path.join(repo, p), 'utf8')

const header = (from) =>
  `/*\n * M11-7A 시안용 사본 — 원본: ${from}\n * 2026-11-14 에 옮겨 적었다. 앱 토큰이 바뀌어도 이 파일은 따라가지 않는다 (design/mockups/README.md).\n */\n`
const tokens = [
  header('src/styles/tokens.css'),
  read('src/styles/tokens.css'),
  header('src/themes/mono-vinyl/tokens.css'),
  read('src/themes/mono-vinyl/tokens.css'),
  header('src/themes/kawaii-synth-cassette/tokens.css'),
  read('src/themes/kawaii-synth-cassette/tokens.css'),
].join('\n')
writeFileSync(path.join(out, 'tokens.css'), tokens)

const svgOf = (file) => {
  const src = read(file)
  const start = src.indexOf('<svg')
  const end = src.indexOf('</svg>') + '</svg>'.length
  return src.slice(start, end).replace(/\s+\n/g, '\n')
}
const decks = {
  mono: svgOf('src/themes/mono-vinyl/DeckArt.vue'),
  kawaii: svgOf('src/themes/kawaii-synth-cassette/DeckArt.vue'),
}
writeFileSync(
  path.join(out, 'decks.js'),
  `/*\n * M11-7A 시안용 데크 아트 사본 — 원본: src/themes/mono-vinyl/DeckArt.vue · src/themes/kawaii-synth-cassette/DeckArt.vue\n * (SVG 를 그대로 옮겼다. 승인된 아트를 바꾸지 않는다.) 2026-11-14.\n */\nwindow.DECK_SVG = ${JSON.stringify(decks)}\n`,
)
console.log('tokens', tokens.length, 'mono', decks.mono.length, 'kawaii', decks.kawaii.length)
