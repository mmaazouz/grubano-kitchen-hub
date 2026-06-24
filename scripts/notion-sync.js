// scripts/notion-sync.js
// Called by Claude Code at start/end of each session to stay in sync with other agents.
//
// USAGE
//   node scripts/notion-sync.js read
//     → prints brain page + last entries for all agents (run at session START)
//
//   node scripts/notion-sync.js write <agentKey> "<inline message>"
//     → legacy inline mode. Shell may mangle long messages with special chars
//       (!, parens, accents, quotes, !). PREFER a file mode below for long reports.
//
//   node scripts/notion-sync.js write-file <agentKey> <path/to/file>
//   node scripts/notion-sync.js write-inbox-file <path/to/file>
//     → reads the file VERBATIM (no shell interpretation at all) and appends as
//       one entry on the target page. RECOMMENDED for any report > 500 chars or
//       containing special characters. The file content is unchanged.
//
// EVERY WRITE MODE
//   • Fails LOUD on any Notion API error (HTTP non-2xx, {object: "error"},
//     network) — prints an explicit reason and exits with code 1. Never silent.
//   • Splits long messages across multiple `rich_text` chunks (Notion's per-text
//     limit is 2000 chars) inside a single paragraph block, so the entry reads
//     as one entry.
//   • After writing, REFETCHES the target page (paginating to the actual last
//     blocks) and verifies the entry is there. Prints:
//         ✅ Inbox mise à jour, entrée confirmée présente            (target = inbox)
//         ✅ Page <name> mise à jour, entrée confirmée présente      (other pages)
//     on success, or
//         ❌ ÉCHEC : l'entrée n'apparaît pas après écriture
//     on failure, with exit 1.
//
// REQUIRED ENV
//   NOTION_TOKEN must be set (export or in .env.local at the repo root). If
//   missing/empty, this script prints an explicit message and exits 1 — it will
//   NOT make an API call that fails obscurely.
//
// AGENT KEYS
//   agent1 = DevOps   |  agent2 = Dashboard
//   agent3 = Consumer |  agent4 = Portails
//   inbox  = Shared inbox

'use strict'

const https = require('https')
const fs    = require('fs')
const path  = require('path')

// ---------------------------------------------------------------------------
// 1) TOKEN DIAGNOSTIC (fail loud BEFORE any API call)
// ---------------------------------------------------------------------------

if (!process.env.NOTION_TOKEN) {
  // Try to load from .env.local at repo root
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^NOTION_TOKEN=(.+)$/)
      if (m) {
        process.env.NOTION_TOKEN = m[1].trim().replace(/^["']|["']$/g, '')
        break
      }
    }
  }
}

const TOKEN = (process.env.NOTION_TOKEN || '').trim()
if (!TOKEN) {
  console.error('❌ NOTION_TOKEN manquant dans l\'environnement.')
  console.error('   Sans token, aucun appel à l\'API Notion ne peut aboutir.')
  console.error('   Solution :')
  console.error('     export NOTION_TOKEN=ntn_xxxxxxxxxxxx')
  console.error('     OR add  NOTION_TOKEN=ntn_xxxxxxxxxxxx  to .env.local at the repo root')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Page IDs
// ---------------------------------------------------------------------------

const PAGE_IDS = {
  brain:  '36dfd2c9-8146-81ae-bfab-e5e09076ea8e',
  agent1: '36dfd2c9-8146-8143-9d64-f7efde1029e3',  // DevOps
  agent2: '36dfd2c9-8146-8106-8049-cc92a50a9112',  // Dashboard
  agent3: '36dfd2c9-8146-81b4-91ec-ecdc8013bad0',  // Consumer
  agent4: '36dfd2c9-8146-8132-9fd0-f53fc6e12226',  // Portails
  inbox:  '389fd2c9-8146-81d9-8527-e8e0a2884a45',  // Shared inbox v58 (📥 INBOX RAPPORTS v58 ACTIVE — archives READ-ONLY: v57 388fd2c9-8146-81ce-9293-f27b93f09653, v56 388fd2c9-8146-8150-ac4c-e5ad739964bb, v55 388fd2c9-8146-8164-bf5b-cc10b26dba00, v54 388fd2c9-8146-81c7-9338-cdfb636b1d79, v53 388fd2c9-8146-81d4-9a65-ce8a227d3c77, v52 388fd2c9-8146-814c-93b4-ef07f6d31509, v51 388fd2c9-8146-8145-995e-c48c6219cece, v50 388fd2c9-8146-8148-a88f-ccc5152f6877, v49 388fd2c9-8146-8192-9e4c-d6bcefd017c6, v48 388fd2c9-8146-81c5-a040-c65333d64e13, v47387fd2c9-8146-8143-bd95-e75e38b3324a, v46 387fd2c9-8146-81a7-a47b-dad512478efa, v45 387fd2c9-8146-81cf-b25c-ddd2458c4429, v44 387fd2c9-8146-8177-af76-d9891be98e12, v43 387fd2c9-8146-8160-b95b-f0f5513ad659, v42 387fd2c9-8146-8162-8caf-f0b53562d168, v41 387fd2c9-8146-8140-86ff-fd9cabb35d0d, v40 387fd2c9-8146-8173-92ad-f4dec6ed503a, v39 387fd2c9-8146-818f-888d-df6bc8478b89, v38 387fd2c9-8146-8114-a255-f60013f3d991, v37 386fd2c9-8146-810a-b8ed-d90702b2fb93, v36 386fd2c9-8146-81ac-9e40-e0ea6d0b687d, v35 386fd2c9-8146-81d0-9f0d-e08288f76c52, v34 385fd2c9-8146-8184-9859-cb12b48d6054, v33 385fd2c9-8146-811c-9021-e794c348f019, v32 385fd2c9-8146-814c-a7b5-d2174c410255, v31 385fd2c9-8146-8145-a6e9-ccb082c5ce05, v30 385fd2c9-8146-81bc-9e2b-c0e2571796d0, v29 385fd2c9-8146-813a-b46d-f3387d3486dc, v28 385fd2c9-8146-8146-8641-dbe950e28977, v27 384fd2c9-8146-814c-bccc-f3de65b0bafb, v26 384fd2c9-8146-81d2-8997-f784acfcda94, v25 384fd2c9-8146-81e0-beb1-c422265a8c1a, v24 384fd2c9-8146-81c9-a712-caf377890dd8, v23 384fd2c9-8146-81e6-91a3-f73041f700b7, v22 384fd2c9-8146-810e-9138-ff595f550629, v21 383fd2c9-8146-8127-b725-eba2f0fa375c, v20 383fd2c9-8146-816d-8439-cfb4c8d00d53, v19 383fd2c9-8146-8155-a904-f1b7d23a54ef, v18 383fd2c9-8146-816b-a199-f2234c066a76, v17 382fd2c9-8146-81cd-a328-ca0627138786, v16 382fd2c9-8146-81ed-baaf-f6e81c119aa4, v15 382fd2c9-8146-8108-911a-fe4febc65e8d, v14 381fd2c9-8146-81bb-947e-f7d0f8ab0cb5, v13 381fd2c9-8146-81f7-bff1-fedc1a2acb4e, v12 380fd2c9-8146-811b-a76b-f436a57b170c, v11 380fd2c9-8146-81aa-8e51-c732972fe4b5, v10 37ffd2c9-8146-8173-ab59-dbd3d7011fcf, v9 37ffd2c9-8146-81d9-b80b-dc038617c533, v8 37ffd2c9-8146-81da-867a-e5b1882c8e94, v7 37ffd2c9-8146-815f-adae-de59909bc765, v6 37efd2c9-8146-814a-aaed-ef6112fa41be, v5 37dfd2c9-8146-817f-8920-c5ad7fe80eae, v4 37dfd2c9-8146-81ab-8cdf-cb8c26038bfc, v3 37cfd2c9-8146-8137-9889-ec75eea3b2e2, v2 37cfd2c9-8146-81d8-860e-c19723e09b15, v1 36efd2c9-8146-8195-a65a-d146cfed0642)
}

const AGENT_NAMES = {
  agent1: 'DevOps',
  agent2: 'Dashboard',
  agent3: 'Consumer',
  agent4: 'Portails',
  inbox:  'Inbox',
}

// ---------------------------------------------------------------------------
// 2) FAIL-LOUD Notion API helper
// ---------------------------------------------------------------------------
// Resolves only on 2xx + non-error body. Rejects with an explicit message on:
//   • network failure
//   • HTTP non-2xx
//   • a body shaped like {object: "error", code, message}
//   • a body that isn't JSON
// Critical: the original implementation resolved any parseable body, including
// {object: "error", status: 400, code: "validation_error", message: "..."},
// which is the exact shape Notion returns when a rich_text chunk exceeds 2000
// chars — and is why Agent 3's long reports failed silently.

function notionRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.notion.com',
      path:     `/v1/${urlPath}`,
      method,
      headers: {
        'Authorization':  `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      const status = res.statusCode
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        let parsed = null
        if (raw) {
          try { parsed = JSON.parse(raw) }
          catch (e) {
            return reject(new Error(
              `Notion API HTTP ${status} but body is not JSON.\n` +
              `  request: ${method} /v1/${urlPath}\n` +
              `  body (first 300 chars): ${raw.slice(0, 300)}`
            ))
          }
        }
        if (status < 200 || status >= 300) {
          const code = (parsed && parsed.code) || '?'
          const msg  = (parsed && parsed.message) || raw.slice(0, 300) || '(no body)'
          return reject(new Error(
            `Notion API HTTP ${status} [${code}]: ${msg}\n` +
            `  request: ${method} /v1/${urlPath}` +
            (parsed ? `\n  full response: ${JSON.stringify(parsed).slice(0, 500)}` : '')
          ))
        }
        if (parsed && parsed.object === 'error') {
          return reject(new Error(
            `Notion API logical error [${parsed.code || '?'}]: ${parsed.message || '?'}\n` +
            `  request: ${method} /v1/${urlPath}`
          ))
        }
        resolve(parsed)
      })
    })
    req.on('error', err => reject(new Error(`Network error to api.notion.com: ${err.message}`)))
    if (payload) req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

function richTextToString(richText) {
  if (!Array.isArray(richText)) return ''
  return richText.map(t => t.plain_text || '').join('')
}

function blockToText(block) {
  const type = block.type
  if (!block[type]) return null
  const rt = block[type].rich_text
  if (!rt) return null
  const text = richTextToString(rt).trim()
  return text || null
}

// Paginates through every child of `pageId` so we can find the LATEST blocks,
// not just the first 100. Notion's GET children returns them in document order,
// so to get the last few we must walk to the end via has_more / next_cursor.
async function fetchAllChildren(pageId) {
  const all = []
  let cursor = null
  do {
    const url = cursor
      ? `blocks/${pageId}/children?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : `blocks/${pageId}/children?page_size=100`
    const res = await notionRequest('GET', url)
    if (Array.isArray(res.results)) all.push(...res.results)
    cursor = res && res.has_more ? res.next_cursor : null
  } while (cursor)
  return all
}

async function getLastBlocks(pageId, n = 5) {
  try {
    const all = await fetchAllChildren(pageId)
    const blocks = all.filter(b => blockToText(b) !== null)
    return blocks.slice(-n).map(b => blockToText(b))
  } catch {
    return ['[could not fetch]']
  }
}

async function getPageMeta(pageId) {
  try {
    const page = await notionRequest('GET', `pages/${pageId}`)
    const title = page.properties?.title?.title?.[0]?.plain_text
               || page.properties?.Name?.title?.[0]?.plain_text
               || '(no title)'
    const edited = page.last_edited_time
      ? new Date(page.last_edited_time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : '?'
    return { title, edited }
  } catch {
    return { title: '(error)', edited: '?' }
  }
}

// Notion rich_text.content limit is 2000 chars per item. Split a long message
// into multiple text chunks inside the SAME paragraph block so it still reads
// as one entry on Notion.
function chunkForRichText(text, maxChunk = 1900) {
  text = String(text == null ? '' : text)
  if (text.length <= maxChunk) return [text]
  const chunks = []
  for (let i = 0; i < text.length; i += maxChunk) {
    chunks.push(text.slice(i, i + maxChunk))
  }
  return chunks
}

function paragraphBlockFromText(content) {
  const chunks = chunkForRichText(content)
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: chunks.map(c => ({
        type: 'text',
        text: { content: c },
      })),
    },
  }
}

function resolvePageId(agentKey) {
  if (PAGE_IDS[agentKey]) return PAGE_IDS[agentKey]
  if (agentKey && agentKey.includes('-')) return agentKey  // raw UUID
  return null
}

function targetLabel(agentKey) {
  if (agentKey === 'inbox') return 'Inbox'
  if (AGENT_NAMES[agentKey]) return `${agentKey} (${AGENT_NAMES[agentKey]})`
  return agentKey
}

// Small helper to wait between retries.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// READ — print brain + all agent pages
// ---------------------------------------------------------------------------

async function readAll() {
  console.log('\n' + '='.repeat(60))
  console.log('  GRUBANO NOTION SYNC — Session start')
  console.log('='.repeat(60))

  const brain = await getPageMeta(PAGE_IDS.brain)
  const brainBlocks = await getLastBlocks(PAGE_IDS.brain, 8)
  console.log(`\n[BRAIN]  last updated: ${brain.edited}`)
  for (const line of brainBlocks) console.log(`  ${line}`)

  const SHARED_FILES = ['prisma/schema.prisma', 'middleware.ts']
  const conflicts = []

  for (const [key, id] of Object.entries(PAGE_IDS)) {
    if (key === 'brain') continue
    const name = AGENT_NAMES[key] || key
    const meta = await getPageMeta(id)
    const blocks = await getLastBlocks(id, 5)

    console.log(`\n[${key.toUpperCase()} — ${name}]  last updated: ${meta.edited}`)
    for (const line of blocks) {
      console.log(`  ${line}`)
      for (const file of SHARED_FILES) {
        if (line.toLowerCase().includes(file.toLowerCase()) &&
            line.toLowerCase().includes('modif')) {
          conflicts.push(`${key} (${name}) may have modified ${file}`)
        }
      }
    }
  }

  if (conflicts.length > 0) {
    console.log('\n' + '!'.repeat(60))
    console.log('  CONFLICTS DETECTED — coordinate before touching these files:')
    for (const c of conflicts) console.log(`  - ${c}`)
    console.log('!'.repeat(60))
  }

  console.log('\n' + '='.repeat(60))
  console.log('  Ready. Check above for blockers before starting work.')
  console.log('='.repeat(60) + '\n')
}

// ---------------------------------------------------------------------------
// WRITE — append + read-back confirmation
// ---------------------------------------------------------------------------

async function writeToAgent(agentKey, message) {
  const pageId = resolvePageId(agentKey)
  if (!pageId) {
    console.error(`❌ Unknown agent key: "${agentKey}"`)
    console.error('   Valid keys: ' + Object.keys(PAGE_IDS).filter(k => k !== 'brain').join(', '))
    console.error('   Or pass a raw Notion page UUID.')
    process.exit(1)
  }
  if (!message || !String(message).trim()) {
    console.error('❌ Empty message — refusing to write a blank entry.')
    process.exit(1)
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const label = targetLabel(agentKey)
  const entry = `[${now} UTC] ${String(message)}`

  console.log(`[notion-sync] Writing to ${label}…`)
  console.log(`              page id      : ${pageId}`)
  console.log(`              entry length : ${entry.length} chars`)
  if (entry.length > 1900) {
    const chunkCount = Math.ceil(entry.length / 1900)
    console.log(`              chunked into : ${chunkCount} rich_text items (Notion 2000-char/text limit)`)
  }

  // PATCH the page with divider + paragraph (chunked rich_text)
  await notionRequest('PATCH', `blocks/${pageId}/children`, {
    children: [
      { object: 'block', type: 'divider', divider: {} },
      paragraphBlockFromText(entry),
    ],
  })

  // 3) READ-BACK CONFIRMATION
  // Refetch and check the entry is actually there. Use the first 80 chars of
  // the entry (timestamp + start of message) as the marker — unique enough that
  // collisions are effectively impossible (we'd need two writes in the same
  // minute with the same opening 60 chars of message).
  const marker = entry.slice(0, 80)

  // Tiny retry loop in case the index is briefly inconsistent after PATCH.
  let found = false
  let lastConcat = ''
  for (let attempt = 0; attempt < 3 && !found; attempt++) {
    if (attempt > 0) await sleep(750)
    try {
      const all = await fetchAllChildren(pageId)
      const recentText = all.slice(-12).map(blockToText).filter(Boolean).join('\n')
      lastConcat = recentText
      if (recentText.includes(marker)) found = true
    } catch (e) {
      console.error(`   read-back attempt ${attempt + 1} fetch error: ${e.message}`)
    }
  }

  if (found) {
    if (agentKey === 'inbox') {
      console.log('✅ Inbox mise à jour, entrée confirmée présente')
    } else {
      console.log(`✅ Page ${label} mise à jour, entrée confirmée présente`)
    }
    console.log(`   marker (60 first chars): ${marker.slice(0, 60).replace(/\s+/g, ' ')}`)
    return  // resolved Promise → main .catch chain still runs but no error
  }

  console.error(`❌ ÉCHEC : l'entrée n'apparaît pas après écriture sur ${label}`)
  console.error(`   marker recherché (60 first chars): ${marker.slice(0, 60).replace(/\s+/g, ' ')}`)
  console.error(`   derniers blocs lus (last 300 chars of concat):`)
  console.error(`     ${lastConcat.slice(-300).replace(/\n/g, ' | ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readFileVerbatim(filepath) {
  if (!filepath) {
    console.error('❌ Missing file path argument.')
    process.exit(1)
  }
  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`)
    process.exit(1)
  }
  try { return fs.readFileSync(filepath, 'utf8') }
  catch (e) {
    console.error(`❌ Cannot read ${filepath}: ${e.message}`)
    process.exit(1)
  }
}

function usage(exitCode) {
  console.log('Usage:')
  console.log('  node scripts/notion-sync.js read')
  console.log('  node scripts/notion-sync.js write <agentKey> "<inline message>"')
  console.log('  node scripts/notion-sync.js write-file <agentKey> <path/to/file>')
  console.log('  node scripts/notion-sync.js write-inbox-file <path/to/file>')
  console.log('')
  console.log('Agent keys:')
  for (const [k, name] of Object.entries(AGENT_NAMES)) console.log(`  ${k} = ${name}`)
  console.log('')
  console.log('Tips:')
  console.log('  • For reports > 500 chars or with special chars (! () accents " /)')
  console.log('    PREFER write-file / write-inbox-file — shell quoting is bypassed.')
  console.log('  • Every write mode prints ✅ (confirmed) or ❌ (failed) at the end.')
  console.log('    If you see ❌, retry with the file mode.')
  process.exit(exitCode || 1)
}

const [,, action, ...args] = process.argv

if (action === 'read') {
  readAll().catch(err => {
    console.error('❌ notion-sync read failed:', err.message)
    process.exit(1)
  })

} else if (action === 'write') {
  const [agentKey, ...rest] = args
  const message = rest.join(' ')
  if (!agentKey || !message) {
    console.error('Usage: node scripts/notion-sync.js write <agentKey> "<message>"')
    console.error('  For long reports with special chars, prefer:')
    console.error('    node scripts/notion-sync.js write-file <agentKey> <path>')
    console.error('    node scripts/notion-sync.js write-inbox-file <path>')
    process.exit(1)
  }
  writeToAgent(agentKey, message).catch(err => {
    console.error('❌ notion-sync write failed:', err.message)
    process.exit(1)
  })

} else if (action === 'write-file') {
  const [agentKey, filepath] = args
  if (!agentKey || !filepath) {
    console.error('Usage: node scripts/notion-sync.js write-file <agentKey> <path/to/file>')
    process.exit(1)
  }
  const content = readFileVerbatim(filepath)
  writeToAgent(agentKey, content).catch(err => {
    console.error('❌ notion-sync write-file failed:', err.message)
    process.exit(1)
  })

} else if (action === 'write-inbox-file') {
  const [filepath] = args
  if (!filepath) {
    console.error('Usage: node scripts/notion-sync.js write-inbox-file <path/to/file>')
    process.exit(1)
  }
  const content = readFileVerbatim(filepath)
  writeToAgent('inbox', content).catch(err => {
    console.error('❌ notion-sync write-inbox-file failed:', err.message)
    process.exit(1)
  })

} else {
  usage(action ? 1 : 0)
}
