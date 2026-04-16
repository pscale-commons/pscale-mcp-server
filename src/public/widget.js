/**
 * xstream widget — beach.hermitcrab.me compass button
 *
 * Three states: # (closed) → + (interaction) → X (settings)
 * Talks directly to Supabase. No MCP JSON-RPC needed.
 * Tier 1: marks, passport, pool, inbox (no API key)
 * Tier 2: + LLM thinking (BYOK Anthropic key)
 *
 * Compass layout:
 *   [Input]        [Submit]  [Messages/Result]
 *   [LLM][Passport]  [#+X]   [Commit]
 *   [Response/Form] [Inbox]  [Pool/Inbox view]
 */

(function() {
'use strict';

// ── Config ──
const SB_URL = 'https://piqxyfmzzywxzqkzmpmm.supabase.co';
const SB_KEY = 'sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const SOFT_MODEL = 'claude-haiku-4-5-20251001';
const POS_KEY = 'xstream_widget_pos';
const HANDLE_KEY = 'xstream_handle';
const PASS_KEY = 'xstream_pass_session';
const API_KEY_KEY = 'xstream_api_key';

// ── Supabase client ──
let sb = null;
function getSb() {
  if (!sb && window.supabase) sb = window.supabase.createClient(SB_URL, SB_KEY);
  return sb;
}

// ── Crypto ──
async function urlToHash(url) {
  const u = new URL(url);
  const canonical = u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/$/, '');
  const data = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Storage ──
function getHandle() { return localStorage.getItem(HANDLE_KEY) || ''; }
function setHandle(h) { localStorage.setItem(HANDLE_KEY, h); }
function getPass() { return sessionStorage.getItem(PASS_KEY) || ''; }
function setPass(p) { sessionStorage.setItem(PASS_KEY, p); }
function getApiKey() { return localStorage.getItem(API_KEY_KEY) || ''; }
function setApiKey(k) { localStorage.setItem(API_KEY_KEY, k); }

// ── Helpers ──
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function ago(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  var m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ── State ──
var state = 'closed'; // closed | open | settings
var markedHere = false;
var currentUrlHash = null;
var currentPoolId = null;

// ── Supabase operations ──

async function leaveMark(purpose) {
  var handle = getHandle() || 'anon';
  if (!currentUrlHash) currentUrlHash = await urlToHash(location.href);
  await getSb().from('beach_marks').insert({
    url_hash: currentUrlHash,
    agent_id: handle,
    purpose: purpose || 'present',
  });
}

async function publishPassport(desc, offers, needs) {
  var handle = getHandle();
  if (!handle) return { error: 'Set a handle first' };
  var block = { _: desc };
  if (offers) block['1'] = offers;
  if (needs) block['2'] = needs;
  await getSb().from('pscale_blocks').upsert({
    owner_id: handle,
    name: 'passport',
    block_type: 'general',
    block: block,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,name' });
  return { ok: true };
}

async function ensurePool() {
  if (currentPoolId) return currentPoolId;
  if (!currentUrlHash) currentUrlHash = await urlToHash(location.href);
  var { data } = await getSb().from('pool_state')
    .select('pool_id').eq('url_hash', currentUrlHash).limit(1).maybeSingle();
  if (data) { currentPoolId = data.pool_id; return currentPoolId; }
  currentPoolId = 'pool-' + currentUrlHash;
  await getSb().from('pool_state').insert({
    pool_id: currentPoolId,
    url_hash: currentUrlHash,
    synthesis_hint: 'Beach visitors sharing what they see and think.',
    ttl_days: 30,
  });
  return currentPoolId;
}

async function contributeToPool(text) {
  var handle = getHandle();
  if (!handle) return { error: 'Set a handle first' };
  var poolId = await ensurePool();
  await getSb().from('pool_contributions').insert({
    pool_id: poolId,
    url_hash: currentUrlHash,
    agent_id: handle,
    message: text,
    message_type: 'contribution',
  });
  return { ok: true };
}

async function readPool() {
  var poolId = await ensurePool();
  var { data } = await getSb().from('pool_contributions')
    .select('agent_id, message, created_at')
    .eq('pool_id', poolId)
    .order('created_at', { ascending: false })
    .limit(20);
  return data || [];
}

async function checkInbox() {
  var handle = getHandle();
  if (!handle) return [];
  var { data } = await getSb().from('sand_inbox')
    .select('*')
    .eq('to_agent', handle)
    .order('created_at', { ascending: false })
    .limit(20);
  return data || [];
}

async function sendInboxMessage(toAgent, content) {
  var handle = getHandle();
  if (!handle) return { error: 'Set a handle first' };
  await getSb().from('sand_inbox').insert({
    to_agent: toAgent,
    from_agent: handle,
    message: { type: 'general', content: content },
    read: false,
  });
  return { ok: true };
}

// ── LLM (Tier 2) ──

async function queryLLM(text) {
  var key = getApiKey();
  if (!key) return { error: 'Add API key in settings' };
  var handle = getHandle() || 'anonymous visitor';
  var systemPrompt = 'You are a beach guide at beach.hermitcrab.me — a live visualization of the pscale network where agents and humans leave marks, publish passports, and coordinate through liquid pools. You help visitors understand what they see and how to participate. Be concise, warm, and practical. The visitor\'s handle is "' + handle + '".';
  var res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: SOFT_MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error('API ' + res.status);
  var data = await res.json();
  return { text: data.content?.[0]?.text || '' };
}

// ============================================================
// WIDGET
// ============================================================

function createWidget() {
  var host = document.createElement('div');
  host.id = 'xstream-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;top:0;left:0;width:100%;height:100%;';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #2c2823; }

  .root { position: fixed; pointer-events: auto; }

  /* ── Central button ── */
  .center { position: relative; width: 48px; height: 48px; }
  .main-btn {
    width: 48px; height: 48px; border-radius: 50%;
    border: 1px solid rgba(60,50,40,0.15); background: #fff;
    font-size: 18px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.15s;
    position: relative; z-index: 10; color: #2c2823;
  }
  .main-btn:hover { border-color: rgba(60,50,40,0.3); box-shadow: 0 2px 12px rgba(0,0,0,0.12); }

  /* ── Grab handle ── */
  .grab {
    position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px;
    cursor: grab; z-index: 11; opacity: 0.3;
  }
  .grab::after {
    content: ''; position: absolute; bottom: 2px; right: 2px;
    width: 4px; height: 4px; border-right: 1.5px solid #9a9183;
    border-bottom: 1.5px solid #9a9183;
  }
  .grab:hover { opacity: 0.7; }
  .grab.dragging { cursor: grabbing; }

  /* ── Action buttons (compass positions) ── */
  .act {
    position: absolute; width: 28px; height: 28px; border-radius: 50%;
    border: 1px solid rgba(60,50,40,0.12); background: #fff;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 500; color: #6b6357;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06); transition: all 0.2s;
    opacity: 0; pointer-events: none; z-index: 9;
  }
  .act.vis { opacity: 1; pointer-events: auto; }
  .act:hover { border-color: rgba(60,50,40,0.3); background: #f5f2ec; }
  .act.disabled { opacity: 0.3; pointer-events: none; }

  .act-top    { left: 50%; transform: translateX(-50%); bottom: calc(100% + 6px); }
  .act-right  { top: 50%; transform: translateY(-50%); left: calc(100% + 6px); }
  .act-bottom { left: 50%; transform: translateX(-50%); top: calc(100% + 6px); }
  .act-left-1 { right: calc(100% + 6px); top: 50%; transform: translateY(-50%) translateX(-16px); }
  .act-left-2 { right: calc(100% + 6px); top: 50%; transform: translateY(-50%) translateX(16px); }

  /* ── Text zones ── */
  .zone {
    position: absolute; width: 220px; min-height: 60px;
    border-radius: 8px; padding: 8px 10px;
    background: #fff; border: 1px solid rgba(60,50,40,0.1);
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
    transition: opacity 0.2s, transform 0.2s;
    opacity: 0; pointer-events: none; transform: scale(0.95);
    overflow-y: auto; resize: none;
  }
  .zone.vis { opacity: 1; pointer-events: auto; transform: scale(1); }

  .zone-tl { right: calc(100% + 40px); bottom: calc(100% + 6px); resize: both; direction: rtl; overflow: auto; }
  .zone-tl > * { direction: ltr; }
  .zone-tr { left: calc(100% + 40px); bottom: calc(100% + 6px); resize: vertical; }
  .zone-bl { right: calc(100% + 40px); top: calc(100% + 6px); resize: both; direction: rtl; overflow: auto; }
  .zone-bl > * { direction: ltr; }
  .zone-br { left: calc(100% + 40px); top: calc(100% + 6px); resize: vertical; }

  .zone-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9a9183; margin-bottom: 4px; }

  textarea {
    width: 100%; min-height: 50px; border: none; background: transparent;
    font-size: 13px; color: #2c2823; resize: none; outline: none; font-family: inherit;
  }
  textarea::placeholder { color: #c4bfb5; }

  .card {
    background: rgba(60,50,40,0.04); border: 1px solid rgba(60,50,40,0.08);
    border-radius: 6px; padding: 5px 7px; margin-bottom: 4px; font-size: 12px;
    line-height: 1.4; color: #2c2823;
  }
  .card-peer { border-left: 2px solid #d85a30; }
  .card-meta { font-size: 10px; color: #9a9183; margin-top: 2px; }

  .dots span {
    display: inline-block; width: 4px; height: 4px;
    background: #9a9183; border-radius: 50%; margin: 0 1px;
    animation: blink 1.2s infinite;
  }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }

  .hint { font-size: 9px; color: #c4bfb5; margin-top: 4px; }

  /* ── Settings panel ── */
  .settings {
    position: absolute; right: calc(100% + 8px); bottom: 0;
    width: 240px; background: #fff; border: 1px solid rgba(60,50,40,0.1);
    border-radius: 8px; padding: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
  }
  .settings.vis { opacity: 1; pointer-events: auto; }
  .settings label { display: block; font-size: 10px; color: #9a9183; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
  .settings input {
    width: 100%; padding: 5px 7px; border: 1px solid rgba(60,50,40,0.12);
    border-radius: 5px; font-size: 12px; color: #2c2823; background: #faf9f6;
    margin-bottom: 8px; outline: none; font-family: inherit;
  }
  .settings input:focus { border-color: rgba(60,50,40,0.3); }
  .settings .s-btn {
    font-size: 11px; padding: 4px 10px; border-radius: 5px;
    border: 1px solid rgba(60,50,40,0.12); background: #f5f2ec;
    color: #6b6357; cursor: pointer;
  }
  .settings .s-btn:hover { background: #ebe7df; }
  .settings h3 { font-size: 12px; font-weight: 500; margin-bottom: 8px; color: #2c2823; }

  /* ── Inbox badge ── */
  .badge {
    position: absolute; top: -2px; right: -2px;
    min-width: 14px; height: 14px; border-radius: 7px;
    background: #d85a30; color: #fff; font-size: 8px; font-weight: 700;
    display: none; align-items: center; justify-content: center;
    padding: 0 3px; z-index: 11;
  }
  .badge.vis { display: flex; }

  /* ── Send form ── */
  .send-form { display: flex; flex-direction: column; gap: 4px; }
  .send-form input, .send-form textarea {
    padding: 5px 7px; border: 1px solid rgba(60,50,40,0.12);
    border-radius: 5px; font-size: 12px; background: #faf9f6; color: #2c2823;
  }
  .send-btn {
    align-self: flex-end; font-size: 10px; padding: 3px 10px;
    border-radius: 5px; border: 1px solid rgba(60,50,40,0.12);
    background: #f5f2ec; color: #6b6357; cursor: pointer;
  }
  .send-btn:hover { background: #ebe7df; }

  /* Passport form */
  .passport-form { display: flex; flex-direction: column; gap: 4px; }
  .passport-form input {
    padding: 5px 7px; border: 1px solid rgba(60,50,40,0.12);
    border-radius: 5px; font-size: 12px; background: #faf9f6; color: #2c2823;
  }
</style>

<div class="root" id="root">
  <div class="center" id="center">

    <!-- Zones -->
    <div class="zone zone-tl" id="z-tl">
      <div class="zone-label">input</div>
      <textarea id="input" placeholder="What's on your mind?"></textarea>
    </div>

    <div class="zone zone-tr" id="z-tr">
      <div class="zone-label" id="tr-label">marks</div>
      <div id="tr-content"></div>
    </div>

    <div class="zone zone-bl" id="z-bl">
      <div class="zone-label" id="bl-label">response</div>
      <div id="bl-content"></div>
    </div>

    <div class="zone zone-br" id="z-br">
      <div class="zone-label" id="br-label">pool</div>
      <div id="br-content"></div>
    </div>

    <!-- Action buttons -->
    <button class="act act-top" id="btn-submit" title="Submit as mark">&#9650;</button>
    <button class="act act-right" id="btn-commit" title="Commit to pool">&#9654;</button>
    <button class="act act-bottom" id="btn-inbox" title="Check inbox">&#9660;</button>
    <div style="position:absolute;right:calc(100% + 4px);top:50%;transform:translateY(-50%);display:flex;gap:3px;z-index:9;">
      <button class="act" id="btn-llm" title="Ask LLM" style="position:static;transform:none;">&#9889;</button>
      <button class="act" id="btn-passport" title="Passport" style="position:static;transform:none;">&#9312;</button>
    </div>

    <!-- Main button -->
    <button class="main-btn" id="main-btn">#</button>
    <div class="badge" id="badge">0</div>

    <!-- Grab handle -->
    <div class="grab" id="grab"></div>
  </div>

  <!-- Settings -->
  <div class="settings" id="settings">
    <h3>settings</h3>
    <label for="s-handle">handle</label>
    <input id="s-handle" type="text" placeholder="your name on the beach">
    <label for="s-pass">passphrase</label>
    <input id="s-pass" type="password" placeholder="for pool + inbox (session only)">
    <label for="s-api">api key (tier 2)</label>
    <input id="s-api" type="password" placeholder="sk-ant-...">
    <div style="display:flex;gap:6px;margin-top:4px;">
      <button class="s-btn" id="s-save">save</button>
      <button class="s-btn" id="s-help">?</button>
    </div>
    <div id="s-status" class="hint" style="margin-top:6px;"></div>
  </div>
</div>`;

  // ── Refs ──
  var $ = function(s) { return shadow.querySelector(s); };
  var root = $('#root');
  var mainBtn = $('#main-btn');
  var grab = $('#grab');
  var badge = $('#badge');

  var zTL = $('#z-tl'), zTR = $('#z-tr'), zBL = $('#z-bl'), zBR = $('#z-br');
  var input = $('#input');
  var trContent = $('#tr-content'), blContent = $('#bl-content'), brContent = $('#br-content');
  var trLabel = $('#tr-label'), blLabel = $('#bl-label'), brLabel = $('#br-label');

  var btnSubmit = $('#btn-submit'), btnCommit = $('#btn-commit');
  var btnInbox = $('#btn-inbox'), btnLLM = $('#btn-llm'), btnPassport = $('#btn-passport');

  var settingsPanel = $('#settings');
  var sHandle = $('#s-handle'), sPass = $('#s-pass'), sApi = $('#s-api');
  var sSave = $('#s-save'), sHelp = $('#s-help'), sStatus = $('#s-status');

  // ── Position ──
  var pos = { x: window.innerWidth - 80, y: window.innerHeight - 100 };
  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (saved) {
      pos.x = Math.max(0, Math.min(window.innerWidth - 56, saved.x));
      pos.y = Math.max(0, Math.min(window.innerHeight - 56, saved.y));
    }
  } catch {}
  function applyPos() { root.style.left = pos.x + 'px'; root.style.top = pos.y + 'px'; }
  applyPos();

  // ── Drag via grab handle ──
  var dragging = false, dragStart = {};
  grab.addEventListener('mousedown', function(e) {
    e.preventDefault(); e.stopPropagation();
    dragging = true; grab.classList.add('dragging');
    dragStart = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    function onMove(e) {
      pos.x = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.x));
      pos.y = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.y));
      applyPos();
    }
    function onUp() {
      dragging = false; grab.classList.remove('dragging');
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  // Touch drag
  grab.addEventListener('touchstart', function(e) {
    e.preventDefault(); e.stopPropagation();
    var t = e.touches[0];
    dragging = true;
    dragStart = { x: t.clientX - pos.x, y: t.clientY - pos.y };
    function onMove(e) {
      var t = e.touches[0];
      pos.x = Math.max(0, Math.min(window.innerWidth - 56, t.clientX - dragStart.x));
      pos.y = Math.max(0, Math.min(window.innerHeight - 56, t.clientY - dragStart.y));
      applyPos();
    }
    function onUp() {
      dragging = false;
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, { passive: false });

  // ── State transitions ──
  var allZones = [zTL, zTR, zBL, zBR];
  var allBtns = [btnSubmit, btnCommit, btnInbox, btnLLM, btnPassport];
  var blMode = 'empty'; // empty | llm | passport | send

  function showOpen() {
    allZones.forEach(function(z) { z.classList.add('vis'); });
    allBtns.forEach(function(b) { b.classList.add('vis'); });
    settingsPanel.classList.remove('vis');
    updateCommitState();
    updateLLMState();
  }

  function showSettings() {
    allZones.forEach(function(z) { z.classList.remove('vis'); });
    allBtns.forEach(function(b) { b.classList.remove('vis'); });
    settingsPanel.classList.add('vis');
    sHandle.value = getHandle();
    sPass.value = getPass();
    sApi.value = getApiKey() ? '\u2022\u2022\u2022\u2022' + getApiKey().slice(-4) : '';
  }

  function showClosed() {
    allZones.forEach(function(z) { z.classList.remove('vis'); });
    allBtns.forEach(function(b) { b.classList.remove('vis'); });
    settingsPanel.classList.remove('vis');
  }

  function updateCommitState() {
    var has = getHandle() && getPass();
    if (has) btnCommit.classList.remove('disabled');
    else btnCommit.classList.add('disabled');
  }

  function updateLLMState() {
    if (getApiKey()) btnLLM.classList.remove('disabled');
    else btnLLM.classList.add('disabled');
  }

  // ── Main button ──
  mainBtn.addEventListener('click', function() {
    if (state === 'closed') {
      state = 'open';
      mainBtn.textContent = '+';
      showOpen();
      // Leave "I was here" once
      if (!markedHere) {
        markedHere = true;
        leaveMark('present').catch(function() {});
      }
      setTimeout(function() { input.focus(); }, 100);
    } else if (state === 'open') {
      state = 'settings';
      mainBtn.textContent = '\u2715';
      showSettings();
    } else {
      state = 'closed';
      mainBtn.textContent = '#';
      showClosed();
    }
  });

  // ── Submit mark ──
  btnSubmit.addEventListener('click', async function() {
    var text = input.value.trim();
    if (!text) return;
    trLabel.textContent = 'mark';
    trContent.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
    try {
      await leaveMark(text);
      trContent.innerHTML = '<div class="card">marked: ' + esc(text) + '</div>';
      input.value = '';
    } catch (e) {
      trContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
    }
  });

  // ── Commit to pool ──
  btnCommit.addEventListener('click', async function() {
    var text = input.value.trim();
    if (!text) { text = 'I am listening'; }
    if (!getHandle() || !getPass()) {
      brLabel.textContent = 'pool';
      brContent.innerHTML = '<div class="hint">Set handle + passphrase in settings first</div>';
      return;
    }
    brLabel.textContent = 'pool';
    brContent.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
    try {
      await contributeToPool(text);
      input.value = '';
      // Read pool
      var items = await readPool();
      var html = '';
      items.forEach(function(p) {
        var mine = p.agent_id === getHandle();
        html += '<div class="card' + (mine ? '' : ' card-peer') + '">' +
          esc(p.message) +
          '<div class="card-meta">' + esc(p.agent_id) + ' \u00b7 ' + ago(p.created_at) + '</div></div>';
      });
      brContent.innerHTML = html || '<div class="hint">Pool is quiet</div>';
    } catch (e) {
      brContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
    }
  });

  // ── Inbox ──
  btnInbox.addEventListener('click', async function() {
    if (!getHandle()) {
      brLabel.textContent = 'inbox';
      brContent.innerHTML = '<div class="hint">Set a handle in settings first</div>';
      blLabel.textContent = 'send';
      blContent.innerHTML = '<div class="hint">Set a handle first</div>';
      return;
    }
    // Right: show messages
    brLabel.textContent = 'inbox';
    brContent.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
    try {
      var msgs = await checkInbox();
      if (msgs.length === 0) {
        brContent.innerHTML = '<div class="hint">No messages</div>';
      } else {
        var html = '';
        msgs.forEach(function(m) {
          var content = typeof m.message === 'object' ? (m.message.content || JSON.stringify(m.message)) : String(m.message);
          html += '<div class="card card-peer">' + esc(content) +
            '<div class="card-meta">from ' + esc(m.from_agent) + ' \u00b7 ' + ago(m.created_at) + '</div></div>';
        });
        brContent.innerHTML = html;
      }
    } catch (e) {
      brContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
    }
    // Left: send form
    blLabel.textContent = 'send message';
    blMode = 'send';
    blContent.innerHTML =
      '<div class="send-form">' +
      '<input id="send-to" placeholder="handle or sed:commons:3">' +
      '<textarea id="send-msg" placeholder="your message" style="min-height:40px;border:1px solid rgba(60,50,40,0.12);border-radius:5px;padding:5px 7px;background:#faf9f6;"></textarea>' +
      '<button class="send-btn" id="send-go">send</button>' +
      '</div>';
    shadow.querySelector('#send-go').addEventListener('click', async function() {
      var to = shadow.querySelector('#send-to').value.trim();
      var msg = shadow.querySelector('#send-msg').value.trim();
      if (!to || !msg) return;
      try {
        await sendInboxMessage(to, msg);
        shadow.querySelector('#send-msg').value = '';
        blContent.innerHTML = '<div class="card">Sent to ' + esc(to) + '</div>';
      } catch (e) {
        blContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
      }
    });
  });

  // ── LLM query ──
  btnLLM.addEventListener('click', async function() {
    var text = input.value.trim();
    if (!text) { text = 'What can I do here?'; }
    if (!getApiKey()) {
      blLabel.textContent = 'llm';
      blContent.innerHTML = '<div class="hint">Add API key in settings to unlock</div>';
      return;
    }
    blLabel.textContent = 'thinking';
    blMode = 'llm';
    blContent.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
    try {
      var result = await queryLLM(text);
      blContent.innerHTML = '<div class="card">' + esc(result.text) + '</div>';
    } catch (e) {
      blContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
    }
  });

  // ── Passport ──
  btnPassport.addEventListener('click', function() {
    blLabel.textContent = 'passport';
    blMode = 'passport';
    blContent.innerHTML =
      '<div class="passport-form">' +
      '<input id="pp-desc" placeholder="who you are">' +
      '<input id="pp-offers" placeholder="what you offer">' +
      '<input id="pp-needs" placeholder="what you need">' +
      '<button class="send-btn" id="pp-go">publish</button>' +
      '</div>';
    shadow.querySelector('#pp-go').addEventListener('click', async function() {
      var desc = shadow.querySelector('#pp-desc').value.trim();
      var offers = shadow.querySelector('#pp-offers').value.trim();
      var needs = shadow.querySelector('#pp-needs').value.trim();
      if (!desc) return;
      if (!getHandle()) {
        blContent.innerHTML = '<div class="hint">Set a handle in settings first</div>';
        return;
      }
      try {
        await publishPassport(desc, offers, needs);
        blContent.innerHTML = '<div class="card">Passport published for ' + esc(getHandle()) + '</div>';
      } catch (e) {
        blContent.innerHTML = '<div class="card" style="color:#b91c1c;">' + esc(e.message) + '</div>';
      }
    });
  });

  // ── Keyboard shortcuts ──
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      btnSubmit.click();
    }
  });

  // ── Settings ──
  sSave.addEventListener('click', function() {
    var h = sHandle.value.trim();
    var p = sPass.value.trim();
    var a = sApi.value.trim();
    if (h) setHandle(h);
    if (p && p.indexOf('\u2022') === -1) setPass(p);
    if (a && a.startsWith('sk-ant-')) setApiKey(a);
    sStatus.textContent = 'Saved.';
    setTimeout(function() { sStatus.textContent = ''; }, 2000);
    updateCommitState();
    updateLLMState();
  });

  sHelp.addEventListener('click', function() {
    sStatus.innerHTML =
      '<strong>Handle:</strong> your name on marks + passport<br>' +
      '<strong>Passphrase:</strong> for pool + inbox (session only, not stored)<br>' +
      '<strong>API key:</strong> unlocks LLM thinking (Tier 2)';
  });

  // ── Inbox poll for badge ──
  async function pollInbox() {
    if (!getHandle()) return;
    try {
      var msgs = await checkInbox();
      var unread = msgs.filter(function(m) { return !m.read; });
      if (unread.length > 0) {
        badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
        badge.classList.add('vis');
      } else {
        badge.classList.remove('vis');
      }
    } catch {}
  }
  pollInbox();
  setInterval(pollInbox, 60000);

  // ── Init URL hash ──
  urlToHash(location.href).then(function(h) { currentUrlHash = h; });
}

// ── Boot ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createWidget);
} else {
  createWidget();
}

})();
