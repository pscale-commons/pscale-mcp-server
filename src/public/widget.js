/**
 * xstream widget — standalone embed for beach.hermitcrab.me
 *
 * Ported from the xstream-button Chrome extension.
 * Chrome APIs replaced: storage → localStorage, messaging → direct calls,
 * alarms → setInterval, chrome.runtime.getURL → inline blocks.
 *
 * Tier 2: full compass with BYOK (API key in localStorage).
 * Tier 1 (future): liquid-only, no key required.
 *
 * Usage: <script src="/widget.js"></script>
 * The widget auto-injects on load.
 */

(function() {
'use strict';

// ============================================================
// CONFIG
// ============================================================

const RELAY_BASE = 'https://play.onen.ai/api/relay';
const BEACH_BASE = 'https://play.onen.ai/api/beach';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const SOFT_MODEL = 'claude-haiku-4-5-20251001';
const MEDIUM_MODEL = 'claude-sonnet-4-20250514';
const POLL_INTERVAL_MS = 60000;
const API_KEY_STORAGE = 'xstream_api_key';
const POS_KEY = 'xstream_widget_pos';

// ============================================================
// AGENT BLOCKS — inline (were separate JSON files in extension)
// ============================================================

const SOFT_AGENT_BLOCK = {
  "_": {
    "_": "You are the inner voice for a visitor at this page. Help them think about what they see, what they want, who else is here. Never act. Never narrate. Reflect.",
    "1": "page-context",
    "2": "beach-context"
  },
  "1": {
    "_": "ROLE:",
    "1": "Speak as the visitor's own thinking — curiosity, recognition, doubt, connection.",
    "2": "You see what the page shows. You know who else has been here and why.",
    "3": "Your job: help them decide what to do. Thinking is free. Acting costs a commit."
  },
  "2": {
    "_": "AWARENESS:",
    "1": "The page context tells you what is visible. Do not invent content not on the page.",
    "2": "The beach context tells you who else visited and their purposes. This is social information — who was here, what they wanted.",
    "3": "If purposes resonate — same topic, complementary needs — notice this. Say so briefly.",
    "4": "If nobody has been here, that is also information. A quiet beach."
  },
  "3": {
    "_": "STYLE:",
    "1": "1-3 sentences. Concise. No filler. Match the tone of someone thinking while browsing.",
    "2": "Plain text. Conversational. No JSON. No schema. No formatting.",
    "3": "If the visitor asks about something not visible on the page, say so plainly."
  }
};

const MEDIUM_AGENT_BLOCK = {
  "_": {
    "_": "You are the medium for a visitor committing an intention at this page. Resolve what they want into what happened. Produce solid (what occurred), events (facts for others to discover), and domino (who should be notified).",
    "1": "page-context",
    "2": "beach-context"
  },
  "1": {
    "_": "RULES:",
    "1": "The page context is the world. Do not invent elements not visible on the page.",
    "2": "The beach context shows other visitors and their purposes. If the committed intention involves others, reference them.",
    "3": "Accumulated events from peers are established fact. Do not contradict them.",
    "4": "If the intention is informational (summarise, explain, describe), the solid IS the answer. No actions needed."
  },
  "2": {
    "_": "PRODUCE (JSON):",
    "1": "solid: 2-4 sentences describing what happened or what was understood. This is shown to the visitor and discoverable by peers.",
    "2": "events: 1-3 observable facts. Not internal thoughts. Things others could notice.",
    "3": "domino: array of {target, context, urgency} for peers who should respond. Empty array if none."
  },
  "3": "Respond in JSON only. No markdown. No backticks. Keys: solid, events, domino."
};

// ============================================================
// BSP — pure block walker (from bsp.js)
// ============================================================

function collectUnderscore(node) {
  if (typeof node !== 'object' || node === null || !('_' in node)) return null;
  const val = node._;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null) {
    if ('_' in val) return collectUnderscore(val);
  }
  return null;
}

function getHiddenDirectory(node) {
  if (typeof node !== 'object' || node === null || !('_' in node)) return null;
  let current = node._;
  if (typeof current !== 'object' || current === null) return null;
  while (typeof current === 'object' && current !== null) {
    const result = {};
    for (const k of '123456789') {
      if (k in current) result[k] = current[k];
    }
    if (Object.keys(result).length > 0) return result;
    if ('_' in current && typeof current._ === 'object') current = current._;
    else break;
  }
  return null;
}

function bspStar(block, number) {
  const hd = typeof block === 'object' ? getHiddenDirectory(block) : null;
  const semantic = typeof block === 'object' ? collectUnderscore(block) : null;
  return { semantic, hidden: hd };
}

// ============================================================
// DYNAMIC BLOCKS — page + beach context
// ============================================================

function buildPageBlock() {
  const title = document.title || '';
  const meta = document.querySelector('meta[name="description"]')?.content || '';
  const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent?.trim()).filter(Boolean).slice(0, 3);
  const h2s = Array.from(document.querySelectorAll('h2')).map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5);
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  const textContent = main.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '';
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .map(b => b.textContent?.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.textContent?.trim().slice(0, 40)).filter(Boolean).slice(0, 8);

  const block = { _: title + ' — ' + location.href };
  const content = { _: 'Content:' };
  const headings = [...h1s, ...h2s];
  if (headings.length) content['1'] = headings.join('. ');
  if (textContent) content['2'] = textContent;
  block['1'] = content;
  const interactive = { _: 'Interactive elements:' };
  if (buttons.length) interactive['1'] = 'Buttons: ' + buttons.join(', ');
  if (links.length) interactive['3'] = 'Links: ' + links.join(', ');
  if (Object.keys(interactive).length > 1) block['2'] = interactive;
  if (meta) block['3'] = meta;
  return block;
}

function buildBeachBlock(marks) {
  if (!marks || marks.length === 0) return { _: 'No other visitors have been here.' };
  const block = { _: marks.length + ' visitor' + (marks.length > 1 ? 's have' : ' has') + ' been here.' };
  marks.slice(0, 9).forEach(function(m, i) {
    const age = timeAgoShort(m.t || m.created_at);
    const purpose = m.s || m.purpose || 'present';
    block[String(i + 1)] = purpose + ' (' + age + ')';
  });
  return block;
}

function timeAgoShort(d) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

// ============================================================
// CRYPTO
// ============================================================

async function urlToHash(url) {
  try {
    const u = new URL(url);
    const canonical = u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/$/, '') + u.search;
    const data = new TextEncoder().encode(canonical);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch { return null; }
}

function generateAnonId() {
  return 'x-' + crypto.randomUUID().slice(0, 8);
}

// ============================================================
// LLM
// ============================================================

async function callClaude(apiKey, model, prompt, maxTokens) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens || 512, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + err.slice(0, 200));
  }
  const data = await res.json();
  return { text: data.content?.[0]?.text ?? '' };
}

function cleanJson(text) {
  return text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
}

// ============================================================
// RELAY + BEACH APIs
// ============================================================

async function writeBlock(urlHash, anonId, block) {
  try {
    await fetch(RELAY_BASE + '/' + urlHash + '/' + anonId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(block),
    });
  } catch (e) { console.warn('[relay PUT]', e.message); }
}

async function readPeerBlocks(urlHash, myId) {
  try {
    const res = await fetch(RELAY_BASE + '/' + urlHash + '?exclude=' + myId);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function leaveMark(urlHash, agentId, purpose) {
  try {
    await fetch(BEACH_BASE + '/' + urlHash + '/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, purpose: purpose || 'present' }),
    });
  } catch (e) { console.warn('[beach] mark error:', e.message); }
}

async function readMarks(urlHash) {
  try {
    const res = await fetch(BEACH_BASE + '/' + urlHash);
    if (!res.ok) return { marks: [], peer_count: 0 };
    return await res.json();
  } catch { return { marks: [], peer_count: 0 }; }
}

// ============================================================
// PROMPT COMPOSITION — walks agent block + resolves star refs
// ============================================================

function buildPrompt(agentBlock, pageBlock, beachBlock, userMessage) {
  const sections = [];

  // Agent semantic text
  const star = bspStar(agentBlock);
  if (star.semantic) sections.push(star.semantic);

  // Star references → resolve to dynamic blocks
  if (star.hidden) {
    for (const [key, name] of Object.entries(star.hidden).sort()) {
      let refBlock = null;
      if (name === 'page-context') refBlock = pageBlock;
      else if (name === 'beach-context') refBlock = beachBlock;
      if (!refBlock) continue;
      const texts = [];
      const collect = function(node) {
        if (typeof node === 'string') { texts.push(node); return; }
        if (typeof node !== 'object' || node === null) return;
        const us = collectUnderscore(node);
        if (us) texts.push(us);
        for (const k of '123456789') { if (k in node) collect(node[k]); }
      };
      collect(refBlock);
      if (texts.length) sections.push(texts.join('\n'));
    }
  }

  // Agent block branches (rules, style, format)
  for (const d of '123456789') {
    if (!(d in agentBlock)) continue;
    const texts = [];
    const collect = function(node) {
      if (typeof node === 'string') { texts.push(node); return; }
      if (typeof node !== 'object' || node === null) return;
      const us = collectUnderscore(node);
      if (us) texts.push(us);
      for (const k of '123456789') { if (k in node) collect(node[k]); }
    };
    collect(agentBlock[d]);
    if (texts.length) sections.push(texts.join(' '));
  }

  sections.push('\nUSER: ' + userMessage);
  return sections.join('\n\n');
}

// ============================================================
// KERNEL STATE
// ============================================================

let kernel = null;
let pollTimer = null;

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || null;
}

function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key);
}

function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
}

// ============================================================
// KERNEL LIFECYCLE
// ============================================================

async function startKernel() {
  const urlHash = await urlToHash(location.href);
  if (!urlHash) return;
  const anonId = generateAnonId();
  kernel = {
    urlHash, anonId,
    url: location.href,
    block: {
      character: { id: anonId, name: 'anon' },
      status: 'idle', pending_liquid: null,
      outbox: { sequence: 0, events: [], domino: [] },
    },
    lastSeen: {},
    beachMarks: [],
    peerLiquids: [],
  };

  await writeBlock(urlHash, anonId, kernel.block);
  pollCycle();
  pollTimer = setInterval(pollCycle, POLL_INTERVAL_MS);

  // Read beach
  const { marks } = await readMarks(urlHash);
  kernel.beachMarks = marks.filter(function(m) { return m.agent !== anonId; });
  updateBeachDot();
}

async function pollCycle() {
  if (!kernel) return;
  try {
    const peerBlocks = await readPeerBlocks(kernel.urlHash, kernel.anonId);
    const peerLiquids = peerBlocks
      .filter(function(p) { return p.pending_liquid; })
      .map(function(p) { return { id: p.character?.id || 'unknown', name: p.character?.name || 'stranger', liquid: p.pending_liquid }; });
    kernel.peerLiquids = peerLiquids;
    updatePeers(peerLiquids, peerBlocks.length);
  } catch (e) { console.warn('[poll]', e.message); }
}

// ============================================================
// WIDGET — shadow DOM (ported from content.js)
// ============================================================

function createWidget() {
  const host = document.createElement('div');
  host.id = 'xstream-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;top:0;left:0;width:100%;height:100%;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  .widget-root { position: fixed; pointer-events: auto; }

  .compass { position: relative; width: 48px; height: 48px; cursor: grab; }
  .compass.dragging { cursor: grabbing; }

  .main-btn {
    width: 48px; height: 48px; border-radius: 50%;
    border: 1px solid rgba(128,128,128,0.3);
    background: rgba(255,255,255,0.95); color: #333;
    font-size: 18px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    position: relative; z-index: 10;
  }
  .main-btn:hover { border-color: rgba(128,128,128,0.5); }

  .action-btn {
    width: 32px; height: 32px; border-radius: 50%; border: none;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    position: absolute; top: 50%; transform: translateY(-50%);
    transition: opacity 0.2s, transform 0.2s;
    opacity: 0; pointer-events: none;
  }
  .action-btn.visible { opacity: 1; pointer-events: auto; }
  .action-btn:hover { filter: brightness(0.85); }
  .query-btn { right: calc(100% + 6px); background: #e6f1fb; color: #185fa5; }
  .submit-btn { left: calc(100% + 6px); background: #eaf3de; color: #3b6d11; }

  .zone {
    position: absolute; width: 260px; max-height: 180px;
    border-radius: 10px; padding: 8px 10px; font-size: 13px;
    overflow-y: auto; transition: opacity 0.25s, transform 0.25s;
    opacity: 0; pointer-events: none; transform: scale(0.95);
    background: rgba(255,255,255,0.96);
    border: 1px solid rgba(128,128,128,0.15);
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  .zone.visible { opacity: 1; pointer-events: auto; transform: scale(1); }

  .vapor-input { right: calc(100% + 8px); bottom: calc(100% + 8px); }
  .vapor-reply { right: calc(100% + 8px); top: calc(100% + 8px); }
  .liquid-zone { left: calc(100% + 8px); top: calc(100% + 8px); }
  .solid-zone  { left: calc(100% + 8px); bottom: calc(100% + 8px); }

  .zone-label { font-size: 10px; font-weight: 600; text-transform: lowercase; color: rgba(128,128,128,0.7); margin-bottom: 4px; }

  textarea.vapor-textarea {
    width: 100%; height: 80px; border: none; background: transparent;
    font-size: 13px; color: inherit; resize: none; outline: none; font-family: inherit;
  }
  textarea.vapor-textarea::placeholder { color: rgba(128,128,128,0.5); }

  .card { background: rgba(128,128,128,0.06); border: 1px solid rgba(128,128,128,0.1); border-radius: 6px; padding: 5px 7px; margin-bottom: 4px; font-size: 12px; }
  .card-peer { border-left: 2px solid #185fa5; }

  .commit-btn { font-size: 10px; padding: 2px 8px; border-radius: 4px; background: rgba(128,128,128,0.1); border: 1px solid rgba(128,128,128,0.2); color: inherit; cursor: pointer; }
  .commit-btn:hover { background: rgba(128,128,128,0.2); }

  .peer-badge { font-size: 10px; background: #e6f1fb; color: #185fa5; padding: 1px 6px; border-radius: 8px; display: inline-block; }

  .typing-dots span { display: inline-block; width: 4px; height: 4px; background: rgba(128,128,128,0.5); border-radius: 50%; margin: 0 1px; animation: blink 1.2s infinite; }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

  .kb-hint { font-size: 9px; color: rgba(128,128,128,0.5); margin-top: 4px; text-align: right; }

  .beach-dot { position: absolute; top: -2px; right: -2px; width: 14px; height: 14px; border-radius: 50%; background: #d97706; color: white; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; z-index: 11; pointer-events: none; }

  .proximity-toast { position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%); background: rgba(217,119,6,0.95); color: white; padding: 6px 12px; border-radius: 8px; font-size: 11px; white-space: nowrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis; animation: toast-in 0.3s ease; pointer-events: auto; cursor: pointer; }
  @keyframes toast-in { from { opacity: 0; transform: translateX(-50%) translateY(4px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

  /* API key setup */
  .key-setup { font-size: 12px; color: #666; }
  .key-setup input { width: 100%; padding: 4px 6px; border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; font-size: 12px; font-family: monospace; background: transparent; color: inherit; margin: 4px 0; }
  .key-setup button { font-size: 10px; padding: 3px 10px; border-radius: 4px; border: 1px solid rgba(128,128,128,0.3); background: rgba(128,128,128,0.1); color: inherit; cursor: pointer; }
  .key-setup button:hover { background: rgba(128,128,128,0.2); }
  .key-setup .key-status { font-size: 10px; color: rgba(128,128,128,0.6); margin-top: 4px; }
</style>

<div class="widget-root" id="widget">
  <div class="compass" id="compass">
    <div class="zone vapor-input" id="zone-vapor-input">
      <div class="zone-label">vapor</div>
      <textarea class="vapor-textarea" id="input" placeholder="What are you thinking?"></textarea>
      <div class="kb-hint">\u2318\u23CE query \u00b7 \u21E7\u23CE submit</div>
    </div>

    <div class="zone vapor-reply" id="zone-vapor-reply">
      <div class="zone-label">reply</div>
      <div id="reply-content"><div class="key-setup" id="key-setup">
        <div>Add your Anthropic API key to unlock private thinking:</div>
        <input type="password" id="key-input" placeholder="sk-ant-...">
        <button id="key-save">save key</button>
        <div class="key-status" id="key-status"></div>
      </div></div>
    </div>

    <div class="zone liquid-zone" id="zone-liquid">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <div class="zone-label" style="margin:0;">liquid</div>
        <span class="peer-badge" id="peer-badge" style="display:none;"></span>
        <span style="flex:1;"></span>
        <button class="commit-btn" id="commit-btn" style="display:none;">commit</button>
      </div>
      <div id="liquid-content"></div>
    </div>

    <div class="zone solid-zone" id="zone-solid">
      <div class="zone-label">solid</div>
      <div id="solid-content"></div>
    </div>

    <button class="action-btn query-btn" id="query-btn" title="Query">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    </button>
    <button class="action-btn submit-btn" id="submit-btn" title="Submit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>

    <button class="main-btn" id="main-btn">#</button>
    <div class="beach-dot" id="beach-dot" style="display:none;"></div>
  </div>
</div>`;

  // ── Widget state ──
  const $ = function(sel) { return shadow.querySelector(sel); };
  const mainBtn = $('#main-btn');
  const queryBtn = $('#query-btn');
  const submitBtn = $('#submit-btn');
  const commitBtn = $('#commit-btn');
  const input = $('#input');
  const peerBadge = $('#peer-badge');
  const compass = $('#compass');
  const widgetRoot = $('#widget');

  let isOpen = false;
  let liquidItems = [];
  let solidItems = [];
  let beachMarks = [];

  const zones = ['#zone-vapor-input', '#zone-vapor-reply', '#zone-liquid', '#zone-solid'];

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── API key setup ──
  const keySetup = $('#key-setup');
  const keyInput = $('#key-input');
  const keySave = $('#key-save');
  const keyStatus = $('#key-status');

  function refreshKeyUI() {
    const key = getApiKey();
    if (key) {
      keySetup.innerHTML = '<div class="key-status">API key set (\u2022\u2022\u2022\u2022' + key.slice(-4) + ')</div>' +
        '<button id="key-clear" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid rgba(128,128,128,0.3);background:transparent;color:inherit;cursor:pointer;margin-top:4px;">clear key</button>';
      shadow.querySelector('#key-clear').onclick = function() {
        clearApiKey();
        refreshKeyUI();
      };
    }
  }

  keySave.onclick = function() {
    const val = keyInput.value.trim();
    if (!val.startsWith('sk-ant-')) {
      keyStatus.textContent = 'Key must start with sk-ant-';
      return;
    }
    setApiKey(val);
    refreshKeyUI();
    // Start kernel now that we have a key
    if (!kernel) startKernel();
  };

  refreshKeyUI();

  // ── Beach marks display ──
  function renderBeachMarks() {
    const solidEl = $('#solid-content');
    if (beachMarks.length === 0 && solidItems.length === 0) {
      solidEl.innerHTML = '<div style="font-size:11px;color:rgba(128,128,128,0.5);text-align:center;padding:12px 0;">No activity at this page yet</div>';
      return;
    }
    let html = '';
    if (beachMarks.length > 0) {
      html += '<div style="font-size:10px;font-weight:600;color:rgba(128,128,128,0.6);margin-bottom:4px;">Others looked for:</div>';
      beachMarks.forEach(function(m) {
        html += '<div class="card card-peer"><span style="font-size:10px;opacity:0.5;">' + timeAgoShort(m.t || m.created_at) + '</span> ' + escHtml(m.s || m.purpose || 'present') + '</div>';
      });
    }
    solidItems.forEach(function(s) { html += '<div class="card">' + escHtml(s) + '</div>'; });
    solidEl.innerHTML = html;
  }

  // ── Drag ──
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let position = { x: window.innerWidth - 80, y: window.innerHeight - 120 };

  function applyPosition() {
    widgetRoot.style.left = position.x + 'px';
    widgetRoot.style.top = position.y + 'px';
    widgetRoot.style.bottom = 'auto';
    widgetRoot.style.transform = 'none';
  }

  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (saved) {
      position.x = Math.max(0, Math.min(window.innerWidth - 56, saved.x));
      position.y = Math.max(0, Math.min(window.innerHeight - 56, saved.y));
    }
  } catch {}
  applyPosition();

  compass.addEventListener('mousedown', function(e) {
    if (e.target.closest('button') || e.target.closest('textarea') || e.target.closest('input')) return;
    e.preventDefault();
    isDragging = true;
    compass.classList.add('dragging');
    dragStart = { x: e.clientX - position.x, y: e.clientY - position.y };
    function onMove(e) {
      position.x = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.x));
      position.y = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.y));
      applyPosition();
    }
    function onUp() {
      isDragging = false;
      compass.classList.remove('dragging');
      try { localStorage.setItem(POS_KEY, JSON.stringify(position)); } catch {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // ── Open/Close ──
  function toggleOpen() {
    isOpen = !isOpen;
    mainBtn.textContent = isOpen ? '+' : '#';
    zones.forEach(function(sel) { $(sel).classList.toggle('visible', isOpen); });
    queryBtn.classList.toggle('visible', isOpen);
    submitBtn.classList.toggle('visible', isOpen);
    if (isOpen) {
      setTimeout(function() { input.focus(); }, 100);
      renderBeachMarks();
      if (kernel) leaveMark(kernel.urlHash, kernel.anonId, 'present');
    }
  }

  mainBtn.addEventListener('click', function() {
    if (!isDragging) toggleOpen();
  });

  // ── Query soft-LLM ──
  queryBtn.addEventListener('click', async function() {
    const text = input.value.trim();
    if (!text) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      $('#reply-content').innerHTML = '<div style="font-size:11px;color:#b91c1c;">Add your API key first (see reply zone)</div>';
      return;
    }
    $('#reply-content').innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    try {
      const pageBlock = buildPageBlock();
      const beachBlock = buildBeachBlock(kernel?.beachMarks || []);
      const prompt = buildPrompt(SOFT_AGENT_BLOCK, pageBlock, beachBlock, text);
      const { text: reply } = await callClaude(apiKey, SOFT_MODEL, prompt, 512);
      $('#reply-content').textContent = reply.trim();
    } catch (e) {
      $('#reply-content').textContent = 'Error: ' + e.message;
    }
  });

  // ── Submit to liquid ──
  submitBtn.addEventListener('click', function() {
    const text = input.value.trim();
    if (!text) return;
    liquidItems.push({ text: text, self: true });
    input.value = '';
    renderLiquid();
    commitBtn.style.display = 'inline-block';
    if (kernel) {
      kernel.block.pending_liquid = text;
      writeBlock(kernel.urlHash, kernel.anonId, kernel.block);
      leaveMark(kernel.urlHash, kernel.anonId, text.slice(0, 200));
    }
  });

  // ── Commit ──
  commitBtn.addEventListener('click', async function() {
    const selfItems = liquidItems.filter(function(i) { return i.self; });
    if (selfItems.length === 0) return;
    const combined = selfItems.map(function(i) { return i.text; }).join('; ');
    $('#solid-content').innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    const apiKey = getApiKey();
    if (!apiKey) {
      $('#solid-content').textContent = 'Add API key to commit.';
      return;
    }
    try {
      const pageBlock = buildPageBlock();
      const beachBlock = buildBeachBlock(kernel?.beachMarks || []);
      const prompt = buildPrompt(MEDIUM_AGENT_BLOCK, pageBlock, beachBlock, combined);
      const { text } = await callClaude(apiKey, MEDIUM_MODEL, prompt, 1024);
      const result = JSON.parse(cleanJson(text));
      solidItems.push(result.solid || 'Done.');
      renderBeachMarks();
      if (kernel) {
        kernel.block.pending_liquid = null;
        kernel.block.status = 'idle';
        await writeBlock(kernel.urlHash, kernel.anonId, kernel.block);
      }
    } catch (e) {
      solidItems.push('Error: ' + e.message);
      renderBeachMarks();
    }
    liquidItems = liquidItems.filter(function(i) { return !i.self; });
    renderLiquid();
    commitBtn.style.display = 'none';
  });

  // ── Keyboard shortcuts ──
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      queryBtn.click();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      submitBtn.click();
    } else if (e.key === 'Escape') {
      toggleOpen();
    }
  });

  function renderLiquid() {
    var el = $('#liquid-content');
    el.innerHTML = liquidItems.map(function(item) {
      return '<div class="card' + (item.self ? '' : ' card-peer') + '">' +
        (item.self ? '' : '<span style="font-size:10px;opacity:0.7;">' + (item.name || '') + ':</span> ') +
        escHtml(item.text) + '</div>';
    }).join('');
  }

  // ── External update hooks (called by kernel) ──
  window._xstreamWidget = {
    updateBeachDot: function(count) {
      const dot = shadow.querySelector('#beach-dot');
      if (count > 0) {
        dot.textContent = count > 9 ? '9+' : String(count);
        dot.style.display = 'flex';
      } else {
        dot.style.display = 'none';
      }
    },
    setBeachMarks: function(marks) {
      beachMarks = marks;
      if (isOpen) renderBeachMarks();
    },
    updatePeers: function(peers, count) {
      liquidItems = liquidItems.filter(function(i) { return i.self; });
      peers.forEach(function(p) {
        liquidItems.push({ text: p.liquid, self: false, name: p.name });
      });
      renderLiquid();
      if (count > 0) {
        peerBadge.textContent = count + ' peer' + (count > 1 ? 's' : '');
        peerBadge.style.display = 'inline-block';
      } else {
        peerBadge.style.display = 'none';
      }
    },
  };
}

// ── Bridge functions ──
function updateBeachDot() {
  if (window._xstreamWidget && kernel) {
    const meaningful = kernel.beachMarks.filter(function(m) {
      return m.s && m.s !== 'present' && (m.s || '').length > 3;
    });
    window._xstreamWidget.updateBeachDot(meaningful.length);
    window._xstreamWidget.setBeachMarks(meaningful);
  }
}

function updatePeers(peers, count) {
  if (window._xstreamWidget) {
    window._xstreamWidget.updatePeers(peers, count);
  }
}

// ============================================================
// INIT
// ============================================================

function init() {
  createWidget();
  // Start kernel if API key exists (full tier 2)
  // Even without key, widget shows — liquid and solid work without LLM
  if (getApiKey()) {
    startKernel();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
