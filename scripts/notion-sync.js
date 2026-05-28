// scripts/notion-sync.js
// Called by Claude Code at start/end of each session to stay in sync with other agents.
//
// Usage:
//   node scripts/notion-sync.js read
//     → prints brain page + last entries for all agents (run at session START)
//
//   node scripts/notion-sync.js write agent1 "Built X. Commits: abc123. Next: Y. HTTP 200."
//     → appends timestamped entry to that agent's Notion page (run at session END)
//
// Requires:
//   export NOTION_TOKEN=ntn_xxxx   (or set in .env.local)
//
// Agent IDs:
//   agent1 = DevOps
//   agent2 = Dashboard
//   agent3 = Consumer
//   agent4 = Portails

'use strict'
const https = require('https')
const fs    = require('fs')
const path  = require('path')

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env.local if NOTION_TOKEN not already in environment
if (!process.env.NOTION_TOKEN) {
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^NOTION_TOKEN=(.+)$/)
      if (m) { process.env.NOTION_TOKEN = m[1].trim().replace(/^["']|["']$/g, ''); break }
    }
  }
}

const TOKEN = process.env.NOTION_TOKEN
if (!TOKEN) {
  console.error('[notion-sync] ERROR: NOTION_TOKEN not set.')
  console.error('  export NOTION_TOKEN=ntn_xxxx')
  console.error('  OR add NOTION_TOKEN=ntn_xxxx to .env.local')
  process.exit(1)
}

const PAGE_IDS = {
  brain:  '36dfd2c9-8146-81ae-bfab-e5e09076ea8e',
  agent1: '36dfd2c9-8146-8143-9d64-f7efde1029e3',  // DevOps
  agent2: '36dfd2c9-8146-8106-8049-cc92a50a9112',  // Dashboard
  agent3: '36dfd2c9-8146-81b4-91ec-ecdc8013bad0',  // Consumer
  agent4: '36dfd2c9-8146-8132-9fd0-f53fc6e12226',  // Portails
}

const AGENT_NAMES = {
  agent1: 'DevOps',
  agent2: 'Dashboard',
  agent3: 'Consumer',
  agent4: 'Portails',
}

// ---------------------------------------------------------------------------
// Notion API helper
// ---------------------------------------------------------------------------

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
      let raw = ''
      res.on('data', chunk => raw += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) }
        catch (e) { reject(new Error(`JSON parse error: ${raw.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Helpers
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

async function getLastBlocks(pageId, n = 5) {
  try {
    const res = await notionRequest('GET', `blocks/${pageId}/children?page_size=100`)
    const blocks = (res.results || []).filter(b => blockToText(b) !== null)
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

// ---------------------------------------------------------------------------
// READ — print brain + all agent pages
// ---------------------------------------------------------------------------

async function readAll() {
  console.log('\n' + '='.repeat(60))
  console.log('  GRUBANO NOTION SYNC — Session start')
  console.log('='.repeat(60))

  // Brain page
  const brain = await getPageMeta(PAGE_IDS.brain)
  const brainBlocks = await getLastBlocks(PAGE_IDS.brain, 8)
  console.log(`\n[BRAIN]  last updated: ${brain.edited}`)
  for (const line of brainBlocks) {
    console.log(`  ${line}`)
  }

  // Conflict flags
  const SHARED_FILES = ['prisma/schema.prisma', 'middleware.ts']
  const conflicts = []

  // Each agent
  for (const [key, id] of Object.entries(PAGE_IDS)) {
    if (key === 'brain') continue
    const name = AGENT_NAMES[key] || key
    const meta = await getPageMeta(id)
    const blocks = await getLastBlocks(id, 5)

    console.log(`\n[${key.toUpperCase()} — ${name}]  last updated: ${meta.edited}`)
    for (const line of blocks) {
      console.log(`  ${line}`)
      // Check for shared-file conflict warnings
      for (const file of SHARED_FILES) {
        if (line.toLowerCase().includes(file.toLowerCase()) &&
            line.toLowerCase().includes('modif')) {
          conflicts.push(`${key} (${name}) may have modified ${file}`)
        }
      }
    }
  }

  // Conflict summary
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
// WRITE — append timestamped entry to an agent page
// ---------------------------------------------------------------------------

async function writeToAgent(agentKey, message) {
  const pageId = PAGE_IDS[agentKey] || agentKey
  if (!pageId) {
    console.error(`[notion-sync] Unknown agent: ${agentKey}`)
    console.error('  Valid agents: ' + Object.keys(PAGE_IDS).filter(k => k !== 'brain').join(', '))
    process.exit(1)
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const name = AGENT_NAMES[agentKey] ? `${agentKey} (${AGENT_NAMES[agentKey]})` : agentKey
  const entry = `[${now} UTC] ${message}`

  await notionRequest('PATCH', `blocks/${pageId}/children`, {
    children: [
      {
        object: 'block',
        type: 'divider',
        divider: {},
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: entry },
            annotations: { code: false, bold: false },
          }],
        },
      },
    ],
  })

  console.log(`[notion-sync] Updated ${name}: ${entry}`)
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const [,, action, agentKey, ...rest] = process.argv
const message = rest.join(' ')

if (action === 'read') {
  readAll().catch(err => { console.error('[notion-sync]', err.message); process.exit(1) })
} else if (action === 'write') {
  if (!agentKey || !message) {
    console.error('Usage: node scripts/notion-sync.js write <agentId> "<message>"')
    console.error('  agentId: agent1 | agent2 | agent3 | agent4')
    process.exit(1)
  }
  writeToAgent(agentKey, message).catch(err => { console.error('[notion-sync]', err.message); process.exit(1) })
} else {
  console.log('Usage:')
  console.log('  node scripts/notion-sync.js read')
  console.log('  node scripts/notion-sync.js write agent1 "Built X. Commits: abc. Next: Y. HTTP 200."')
  console.log('')
  console.log('Agent IDs:')
  for (const [k, name] of Object.entries(AGENT_NAMES)) {
    console.log(`  ${k} = ${name}`)
  }
  process.exit(1)
}
