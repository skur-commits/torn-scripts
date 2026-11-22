// ==UserScript==
// @name         Toppzy Bazaar Manager (demo)
// @namespace    toppzy.torn
// @version      0.2.0
// @description  Floating button on every Torn page. Shows your bazaar, inventory, lowest Item Market and bazaar prices, suggests prices, remembers sold-out items (0 left) for refills, and fills the Add/Manage pages. Never saves by itself.
// @author       Toppzy [4422625]
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      weav3r.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  /* ---------- Default settings (all editable in the Settings tab) ---------- */
  const DEF = {
    // Price
    priceSource: 'lowestBoth', // lowestIM | lowestBazaar | lowestBoth | avgBazaar | market
    priceDelta: '-1',          // "-1", "+0", "-1%", "+5%"
    skipLowest: 0,             // ignore the N cheapest listings (outliers / 1-item dumps)
    minPctOfMV: 70,            // never suggest below X % of market value (0 = off)
    // Add items page
    addMode: 'tracked',        // refill | tracked | all
    qtyMode: 'all',            // all | leave
    leaveQty: 1,               // used when qtyMode = leave
    exclude: 'Xanax, Blood Bag, Erotic DVD, Small First Aid Kit',
    // Manage page
    manageMode: 'all',         // all | undercut
    // Fill / API
    refreshBeforeFill: true,   // fetch fresh prices (older than cacheMin) before filling
    tornPerMin: 40,            // max Torn API calls per minute from this script
    cacheMin: 10,              // minutes a price is reused
    useWeav3r: true            // lowest bazaar prices from weav3r.dev (your key is never sent there)
  };

  /* ---------- Storage ---------- */
  const hasGM = typeof GM_getValue === 'function';
  const load = (k, d) => { try { const v = hasGM ? GM_getValue(k) : localStorage.getItem('tbm_' + k); return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return d; } };
  const save = (k, v) => { try { hasGM ? GM_setValue(k, JSON.stringify(v)) : localStorage.setItem('tbm_' + k, JSON.stringify(v)); } catch (e) { } };

  let cfg = Object.assign({}, DEF, load('cfg', {}));
  let key = load('key', '');
  let me = load('me', 0);
  let tracked = load('tracked', {});   // { id: { id, name, type, bzQty, bzPrice, inv, floor, soldOutAt } }
  let priceCache = load('prices', {}); // { id: { t, imList:[], bzList:[], bzAvg, mv } }
  let lastRun = load('lastRun', 0);

  /* ---------- Helpers ---------- */
  const fmt = n => n ? '$' + Math.round(n).toLocaleString('en-US') : '–';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  const excluded = name => cfg.exclude.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(String(name || '').toLowerCase());

  let lastTorn = 0;
  async function torn(path) {
    const gap = 60000 / Math.max(5, +cfg.tornPerMin || 40);
    const wait = lastTorn + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastTorn = Date.now();
    const r = await fetch(`https://api.torn.com/v2/${path}${path.includes('?') ? '&' : '?'}key=${key}&comment=ToppzyBazaar`);
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.error); e.code = j.error.code; throw e; }
    return j;
  }
  function weav3r(id) {
    const url = `https://weav3r.dev/api/marketplace/${id}`;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url, timeout: 15000,
        onload: x => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); } }, onerror: rej, ontimeout: rej }));
    }
    return fetch(url).then(r => r.json());
  }

  /* ---------- Data ---------- */
  async function ensureMe() {
    if (me) return me;
    const j = await torn('user/basic');
    me = (j.profile || j).id || 0; save('me', me);
    return me;
  }

  async function fetchBazaar() {
    const j = await torn('user/bazaar');
    const items = (j.bazaar && j.bazaar.items) || [];
    const seen = new Set();
    for (const it of items) {
      const id = String(it.id); seen.add(id);
      const price = it.price || (it.uids && it.uids[0] && it.uids[0].price) || 0;
      const t = tracked[id] || (tracked[id] = { id, floor: 0 });
      Object.assign(t, { name: it.name, type: it.type, bzQty: it.quantity, bzPrice: price, soldOutAt: 0 });
    }
    // Items no longer in the bazaar stay in the list with 0 (for refills)
    for (const id in tracked) if (!seen.has(id) && tracked[id].bzQty !== 0) { tracked[id].bzQty = 0; tracked[id].soldOutAt = Date.now(); }
  }

  async function fetchInventory(cats) {
    const inv = {};
    for (const c of cats) {
      try {
        const j = await torn(`user/inventory?cat=${encodeURIComponent(c)}&limit=250`);
        for (const it of (j.inventory && j.inventory.items) || []) {
          if (it.equipped || it.faction_owned) continue;
          const id = String(it.id);
          inv[id] = inv[id] || { id, name: it.name, type: c, amount: 0 };
          inv[id].amount += it.amount;
        }
      } catch (e) { if (e.code === 2) throw e; }
    }
    return inv;
  }

  async function fetchPrice(id, force) {
    const c = priceCache[id];
    if (!force && c && Date.now() - c.t < cfg.cacheMin * 60000) return c;
    const p = { t: Date.now(), imList: [], bzList: [], bzAvg: 0, mv: 0 };
    try {
      const j = await torn(`market/${id}/itemmarket?limit=20`);
      const m = j.itemmarket || {};
      p.imList = (m.listings || []).filter(x => x.price > 0).map(x => x.price).sort((a, b) => a - b).slice(0, 10);
      p.mv = +(m.item && m.item.average_price) || 0;
    } catch (e) { if (e.code === 2) throw e; }
    if (cfg.useWeav3r) {
      try {
        const w = await weav3r(id);
        p.bzList = (w.listings || []).filter(x => x.price > 0 && String(x.player_id) !== String(me)).map(x => x.price).sort((a, b) => a - b).slice(0, 10);
        p.bzAvg = +w.bazaar_average || 0;
        if (!p.mv && w.market_price) p.mv = +w.market_price;
      } catch (e) { }
    }
    priceCache[id] = p;
    return p;
  }

  /* ---------- Pricing ---------- */
  const minPos = arr => { const a = arr.filter(x => x > 0); return a.length ? Math.min(...a) : 0; };
  const nth = (list, n) => (list && list.length) ? list[Math.min(n, list.length - 1)] : 0;
  function basePrice(p) {
    const n = +cfg.skipLowest || 0;
    const im = nth(p.imList, n), bz = nth(p.bzList, n);
    switch (cfg.priceSource) {
      case 'lowestIM': return im || bz;
      case 'lowestBazaar': return bz || im;
      case 'avgBazaar': return p.bzAvg || p.mv;
      case 'market': return p.mv;
      default: return minPos([im, bz]);
    }
  }
  function applyDelta(v) {
    const m = String(cfg.priceDelta).replace(/\s/g, '').match(/^([+-]?\d+(?:\.\d+)?)(%?)$/);
    if (!m || !v) return v;
    return m[2] ? v * (1 + (+m[1]) / 100) : v + (+m[1]);
  }
  function suggest(t, p) {
    if (!p) return 0;
    let s = Math.round(applyDelta(basePrice(p)));
    if (+cfg.minPctOfMV && p.mv && s < p.mv * cfg.minPctOfMV / 100) s = Math.round(p.mv * cfg.minPctOfMV / 100);
    if (t && t.floor && s < t.floor) s = t.floor;
    return s > 0 ? s : 0;
  }
  const lowestOther = p => minPos([nth(p.imList, 0), nth(p.bzList, 0)]);
  function status(t, p) {
    p = p || {};
    if (!t.bzQty) return t.inv > 0 ? { k: 'refill', txt: `Sold out · ${t.inv} in inv – refill`, col: '#3d85c6' } : { k: 'empty', txt: 'Sold out · 0 in inv', col: '#777' };
    const lo = lowestOther(p);
    if (lo && t.bzPrice > lo) return { k: 'under', txt: 'Undercut', col: '#e6b800' };
    return { k: 'ok', txt: 'Lowest', col: '#6aa84f' };
  }

  /* ---------- Refresh ---------- */
  let busy = false, invAll = null;
  const ALL_CATS = ['Collectible', 'Clothing', 'Other', 'Tool', 'Melee', 'Defensive', 'Material', 'Car', 'Primary', 'Secondary', 'Book', 'Special', 'Supply Pack', 'Temporary', 'Enhancer', 'Artifact', 'Flower', 'Booster', 'Medical', 'Candy', 'Jewelry', 'Alcohol', 'Plushie', 'Drug', 'Energy Drink'];

  async function guard(fn) {
    if (busy) return;
    if (!key) { askKey(); return; }
    busy = true;
    try { await ensureMe(); await fn(); }
    catch (e) {
      if (e.code === 2) { key = ''; save('key', ''); setStatus('Invalid API key.'); askKey(); }
      else if (e.code === 5) setStatus('Too many API calls – wait a minute.');
      else setStatus('Error: ' + e.message);
    }
    busy = false; save('tracked', tracked); save('prices', priceCache); render();
  }

  // Refresh = your bazaar + inventory + NEW Item Market and bazaar prices for every tracked item
  const refresh = (scanAll, force) => guard(async () => {
    setStatus('Loading bazaar …');
    await fetchBazaar();
    const cats = scanAll ? ALL_CATS : [...new Set(Object.values(tracked).map(t => t.type).filter(Boolean))];
    setStatus(`Loading inventory (${cats.length} categories) …`);
    const inv = await fetchInventory(cats);
    for (const id in tracked) tracked[id].inv = inv[id] ? inv[id].amount : 0;
    if (scanAll) invAll = inv;
    const ids = Object.keys(tracked); let i = 0;
    for (const id of ids) { i++; setStatus(`Prices ${i}/${ids.length} …`); await fetchPrice(id, force); }
    lastRun = Date.now(); save('lastRun', lastRun); setStatus('');
  });

  /* ---------- Filling Torn pages (never saves) ---------- */
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function fillInput(input, v) {
    input.focus();
    setter.call(input, String(Math.round(v)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }
  const pageMode = () => /bazaar\.php/.test(location.href) ? (/#\/manage/.test(location.hash) ? 'manage' : /#\/add/.test(location.hash) ? 'add' : 'bazaar') : '';
  const idOf = el => { const img = el.querySelector('img[src*="/images/items/"]'); return img ? (img.getAttribute('src').match(/items\/(\d+)\//) || [])[1] : null; };

  function manageRows() {
    return [...document.querySelectorAll('[data-testid^="item-"]')].map(row => {
      const input = row.querySelector('[class*="price___"] input:not([type=hidden])');
      const id = idOf(row);
      return id && input ? { id, input, row, name: row.getAttribute('aria-label') || '' } : null;
    }).filter(Boolean);
  }
  // Add items page – BETA, selectors to be verified (step 2)
  function addRows() {
    return [...document.querySelectorAll('li')].map(li => {
      const id = idOf(li); if (!id) return null;
      const inputs = [...li.querySelectorAll('input:not([type=hidden]):not([type=checkbox])')];
      if (!inputs.length) return null;
      const qty = li.querySelector('.amount input:not([type=hidden]), [class*="amount"] input:not([type=hidden])');
      const price = li.querySelector('.price input:not([type=hidden]), [class*="price"] input:not([type=hidden])') || inputs[inputs.length - 1];
      const box = li.querySelector('input[type=checkbox]');
      const name = (li.querySelector('.name-wrap, [class*="name"]') || {}).innerText || '';
      const have = +((li.innerText.match(/x\s?([\d,]+)/) || [])[1] || '').replace(/,/g, '') || 0;
      return { id, qty: qty !== price ? qty : null, price, box, row: li, name: name.trim(), have };
    }).filter(Boolean);
  }

  // Fill = (fresh prices if older than cache) + fill price on Manage / quantity + price on Add
  const fillPage = () => guard(async () => {
    const mode = pageMode();
    if (mode !== 'manage' && mode !== 'add') { setStatus('Open Bazaar → Manage or Add items first.'); return; }
    const rows = mode === 'manage' ? manageRows() : addRows();
    let pick = rows;
    if (mode === 'add') {
      pick = rows.filter(r => {
        const t = tracked[r.id], name = (t && t.name) || r.name;
        if (excluded(name)) return false;
        if (cfg.addMode === 'refill') return t && !t.bzQty;
        if (cfg.addMode === 'tracked') return !!t;
        return true; // all inventory items shown on the Add page
      });
    }
    if (cfg.refreshBeforeFill) {
      let i = 0;
      for (const r of pick) { i++; setStatus(`Prices ${i}/${pick.length} …`); await fetchPrice(r.id, false); }
    }
    let n = 0, skipped = 0;
    for (const r of pick) {
      const t = tracked[r.id] || { id: r.id, floor: 0 };
      const p = priceCache[r.id];
      if (mode === 'manage' && cfg.manageMode === 'undercut' && status(t, p).k !== 'under') continue;
      const s = suggest(t, p);
      if (!s) { skipped++; continue; }
      if (mode === 'add') {
        const have = (t.inv > 0 ? t.inv : 0) || r.have || 1;
        const q = cfg.qtyMode === 'leave' ? have - (+cfg.leaveQty || 0) : have;
        if (q <= 0) { skipped++; continue; }
        if (r.qty) fillInput(r.qty, q);
        else if (r.box && !r.box.checked) r.box.click();
      }
      fillInput(mode === 'manage' ? r.input : r.price, s);
      r.row.style.outline = '2px solid ' + (mode === 'manage' ? '#6aa84f' : '#3d85c6');
      n++;
    }
    setStatus(n ? `${n} items filled${skipped ? `, ${skipped} skipped` : ''} – press «${mode === 'manage' ? 'Save changes' : 'Add to bazaar'}» yourself.${mode === 'add' ? ' (BETA)' : ''}` : 'Nothing to fill with current settings.');
  });

  /* ---------- UI ---------- */
  const CSS = `
  #tbm-btn{position:fixed;right:14px;bottom:130px;z-index:999999;width:46px;height:46px;border-radius:50%;border:2px solid #6aa84f;background:#1b1b1b;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 2px 10px #000a}
  #tbm-btn .b{position:absolute;top:-4px;right:-4px;background:#cc0000;color:#fff;border-radius:9px;font:bold 11px Arial;padding:1px 5px;display:none}
  #tbm{position:fixed;right:10px;bottom:185px;z-index:999999;width:820px;max-width:96vw;max-height:72vh;display:none;flex-direction:column;background:#1b1b1b;color:#ddd;font:12px/1.35 Arial;border:2px solid #6aa84f;border-radius:8px;box-shadow:0 6px 20px #000c}
  #tbm header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #333;flex-wrap:wrap}
  #tbm header b{font-size:14px;color:#fff;margin-right:auto}
  #tbm button{background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:4px;padding:3px 8px;font:12px Arial;cursor:pointer}
  #tbm button.g{background:#38761d;border-color:#6aa84f}#tbm button.bl{background:#0b3d6b;border-color:#3d85c6}
  #tbm button:disabled{opacity:.45;cursor:default}
  #tbm .tabs{display:flex;gap:4px;padding:5px 9px;border-bottom:1px solid #333;flex-wrap:wrap}
  #tbm .tabs button.on{background:#444;border-color:#aaa}
  #tbm .body{overflow:auto;padding:4px 9px 8px}
  #tbm table{width:100%;border-collapse:collapse;color:#ddd;font:12px Arial}
  #tbm th{position:sticky;top:0;background:#1b1b1b;text-align:left;color:#999;font-weight:normal;padding:4px 3px;border-bottom:1px solid #444}
  #tbm td{padding:4px 3px;border-bottom:1px solid #2c2c2c;vertical-align:middle}
  #tbm td.n{text-align:right;white-space:nowrap}
  #tbm .st{display:inline-block;padding:1px 6px;border-radius:9px;color:#000;font-size:11px;white-space:nowrap}
  #tbm input,#tbm select{background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:2px 4px;font:12px Arial}
  #tbm input.fl{width:80px}
  #tbm .set td:first-child{color:#bbb;width:230px}
  #tbm .set h4{margin:10px 0 2px;color:#6aa84f;font-size:12px}
  #tbm .hint{color:#888;font-size:11px}
  #tbm .foot{padding:5px 9px;border-top:1px solid #333;color:#999;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #tbm .warn{color:#ffd966}
  #tbm a{color:#8ab4f8;cursor:pointer}
  `;
  let tab = 'bazaar', filter = 'all', msg = '';

  function build() {
    if (document.getElementById('tbm-btn')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'tbm-btn'; b.title = 'Toppzy Bazaar Manager'; b.innerHTML = '🏪<span class="b"></span>';
    document.body.appendChild(b);
    const w = document.createElement('div'); w.id = 'tbm'; document.body.appendChild(w);
    b.onclick = () => { const open = w.style.display !== 'flex'; w.style.display = open ? 'flex' : 'none'; if (open) { render(); if (key && Date.now() - lastRun > cfg.cacheMin * 60000) refresh(false, false); } };
    badge();
  }
  function setStatus(s) { msg = s; const e = document.getElementById('tbm-msg'); if (e) e.textContent = s; }
  function badge() {
    const n = Object.values(tracked).filter(t => ['under', 'refill'].includes(status(t, priceCache[t.id]).k)).length;
    const e = document.querySelector('#tbm-btn .b'); if (e) { e.textContent = n; e.style.display = n ? 'block' : 'none'; }
  }
  function askKey() {
    const k = (prompt('Paste your own Torn API key (Limited/Minimal is enough – 16 characters). It is stored locally and only sent to api.torn.com:') || '').trim();
    if (!k) return;
    if (k.length !== 16) { alert('The key must be 16 characters.'); return; }
    key = k; save('key', k); me = 0; save('me', 0); refresh(false, true);
  }

  function render() {
    const w = document.getElementById('tbm'); if (!w) return;
    const all = Object.values(tracked);
    const cnt = k => all.filter(t => status(t, priceCache[t.id]).k === k).length;
    const value = all.reduce((s, t) => s + (t.bzQty || 0) * (t.bzPrice || 0), 0);
    const mode = pageMode();
    const fillTxt = mode === 'manage' ? '✎ Fill prices (Manage)' : mode === 'add' ? '✎ Fill items (Add)' : '✎ Fill page';
    w.innerHTML = `
      <header><b>🏪 Bazaar Manager <span style="color:#777;font-size:11px">demo 0.2</span></b>
        <button class="g" data-a="refresh" title="Reload your bazaar, inventory and fresh Item Market + bazaar prices">⟳ Refresh prices</button>
        <button class="bl" data-a="fill" ${mode === 'manage' || mode === 'add' ? '' : 'disabled title="Open Bazaar → Manage or Add items"'}>${fillTxt}</button>
        <button data-a="key" title="API key">🔑</button><button data-a="close">✕</button></header>
      <div class="tabs">
        <button data-tab="bazaar" class="${tab === 'bazaar' ? 'on' : ''}">My items (${all.length})</button>
        <button data-tab="inv" class="${tab === 'inv' ? 'on' : ''}">From inventory</button>
        <button data-tab="set" class="${tab === 'set' ? 'on' : ''}">⚙ Settings</button>
        ${tab === 'bazaar' ? `<span style="margin-left:auto"></span>
          <button data-f="all" class="${filter === 'all' ? 'on' : ''}">All</button>
          <button data-f="under" class="${filter === 'under' ? 'on' : ''}">Undercut ${cnt('under')}</button>
          <button data-f="sold" class="${filter === 'sold' ? 'on' : ''}">Sold out ${cnt('refill') + cnt('empty')}</button>` : ''}
      </div>
      <div class="body">${tab === 'bazaar' ? viewBazaar() : tab === 'inv' ? viewInv() : viewSet()}</div>
      <div class="foot"><span>In bazaar: <b style="color:#fff">${fmt(value)}</b></span><span>Updated: ${ago(lastRun)}</span>
        <span class="hint">Price: ${esc(srcLabel())} ${esc(cfg.priceDelta)}</span>
        <a data-a="go-manage">Go to Manage</a><a data-a="go-add">Go to Add items</a>
        <span id="tbm-msg" class="warn">${esc(msg)}</span></div>`;
    w.querySelectorAll('[data-tab]').forEach(e => e.onclick = () => { tab = e.dataset.tab; render(); });
    w.querySelectorAll('[data-f]').forEach(e => e.onclick = () => { filter = e.dataset.f; render(); });
    w.querySelectorAll('[data-a]').forEach(e => e.onclick = () => act(e.dataset.a, e));
    w.querySelectorAll('input.fl').forEach(e => e.onchange = () => { const t = tracked[e.dataset.id]; if (t) { t.floor = +e.value.replace(/[^0-9]/g, '') || 0; save('tracked', tracked); render(); } });
    w.querySelectorAll('[data-set]').forEach(e => e.onchange = () => {
      const k = e.dataset.set;
      cfg[k] = e.type === 'checkbox' ? e.checked : (typeof DEF[k] === 'number' ? (+e.value || 0) : e.value);
      save('cfg', cfg); render();
    });
    badge();
  }
  const SRC = { lowestBoth: 'Lowest of Item Market & bazaar', lowestIM: 'Lowest Item Market', lowestBazaar: 'Lowest bazaar', avgBazaar: 'Average bazaar', market: 'Market value' };
  const srcLabel = () => SRC[cfg.priceSource] + (+cfg.skipLowest ? ` (skip ${cfg.skipLowest})` : '');

  function viewBazaar() {
    if (!key) return '<p>Press 🔑 and paste an API key to start.</p>';
    let list = Object.values(tracked).map(t => ({ t, p: priceCache[t.id] || {}, s: status(t, priceCache[t.id]) }));
    if (filter !== 'all') list = list.filter(x => filter === 'sold' ? (x.s.k === 'refill' || x.s.k === 'empty') : x.s.k === filter);
    const order = { under: 0, refill: 1, ok: 2, empty: 3 };
    list.sort((a, b) => order[a.s.k] - order[b.s.k] || (a.t.name || '').localeCompare(b.t.name || ''));
    if (!list.length) return '<p>No items yet – press ⟳ Refresh prices.</p>';
    return `<table><tr><th>Item</th><th class="n">In bazaar</th><th class="n">Your price</th><th class="n">Inv</th><th class="n">Lowest IM</th><th class="n">Lowest bazaar</th><th class="n">Avg bazaar</th><th class="n">Market v.</th><th class="n">Suggested</th><th>Floor</th><th>Status</th><th></th></tr>` +
      list.map(({ t, p, s }) => `<tr>
        <td><a href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${t.id}" target="_blank">${esc(t.name || t.id)}</a></td>
        <td class="n">${t.bzQty || 0}</td><td class="n">${t.bzQty ? fmt(t.bzPrice) : '–'}</td><td class="n">${t.inv || 0}</td>
        <td class="n">${fmt(nth(p.imList, 0))}</td><td class="n">${fmt(nth(p.bzList, 0))}</td><td class="n">${fmt(p.bzAvg)}</td><td class="n">${fmt(p.mv)}</td>
        <td class="n"><b style="color:#fff">${fmt(suggest(t, priceCache[t.id]))}</b></td>
        <td><input class="fl" data-id="${t.id}" value="${t.floor || ''}" placeholder="min $"></td>
        <td><span class="st" style="background:${s.col}">${esc(s.txt)}</span></td>
        <td><a data-a="forget" data-id="${t.id}" title="Stop tracking">✕</a></td></tr>`).join('') + '</table>';
  }

  function viewInv() {
    if (!invAll) return '<p>Scan your whole inventory (25 categories ≈ 25 API calls) to find items you can add.</p><button class="g" data-a="scan">Scan inventory</button>';
    const list = Object.values(invAll).filter(i => i.amount > 0).sort((a, b) => a.name.localeCompare(b.name));
    return `<p><button class="g" data-a="scan">Scan again</button> <button data-a="trackall">+ Track all (except excluded)</button>
      <span class="hint">Only items you actually own. Equipped and faction-owned items are hidden.</span></p>
      <table><tr><th>Item</th><th>Category</th><th class="n">Amount</th><th></th></tr>` +
      list.map(i => `<tr><td>${esc(i.name)}${excluded(i.name) ? ' <span class="hint">(excluded)</span>' : ''}</td><td>${esc(i.type)}</td><td class="n">${i.amount}</td>
        <td>${tracked[i.id] ? '<span style="color:#6aa84f">Tracked</span>' : `<button data-a="track" data-id="${i.id}">+ Track</button>`}</td></tr>`).join('') + '</table>';
  }

  const opt = (k, v, label) => `<option value="${v}" ${cfg[k] === v ? 'selected' : ''}>${label}</option>`;
  function viewSet() {
    return `<div class="set">
      <h4>💲 Price</h4><table>
      <tr><td>Base price on</td><td><select data-set="priceSource">
        ${opt('priceSource', 'lowestBoth', 'Lowest of Item Market & bazaar')}
        ${opt('priceSource', 'lowestIM', 'Lowest Item Market')}
        ${opt('priceSource', 'lowestBazaar', 'Lowest bazaar')}
        ${opt('priceSource', 'avgBazaar', 'Average bazaar')}
        ${opt('priceSource', 'market', 'Market value')}</select></td></tr>
      <tr><td>Price delta</td><td><input data-set="priceDelta" value="${esc(cfg.priceDelta)}" style="width:70px"> <span class="hint">e.g. -1, 0, +100, -1%, -5%</span></td></tr>
      <tr><td>Skip the N cheapest listings</td><td><input data-set="skipLowest" value="${cfg.skipLowest}" style="width:50px"> <span class="hint">0 = undercut the very lowest. 1–2 ignores single cheap dumps.</span></td></tr>
      <tr><td>Never below % of market value</td><td><input data-set="minPctOfMV" value="${cfg.minPctOfMV}" style="width:50px"> % <span class="hint">0 = off. Per-item floor is set in My items.</span></td></tr>
      </table>
      <h4>➕ Add items page</h4><table>
      <tr><td>Which items to fill</td><td><select data-set="addMode">
        ${opt('addMode', 'refill', 'Refill sold-out items only')}
        ${opt('addMode', 'tracked', 'All tracked items (My items)')}
        ${opt('addMode', 'all', 'All items in inventory')}</select></td></tr>
      <tr><td>Quantity</td><td><select data-set="qtyMode">
        ${opt('qtyMode', 'all', 'Everything I have')}
        ${opt('qtyMode', 'leave', 'Leave some in inventory')}</select>
        ${cfg.qtyMode === 'leave' ? `leave <input data-set="leaveQty" value="${cfg.leaveQty}" style="width:45px">` : ''}</td></tr>
      <tr><td>Never add (comma-separated names)</td><td><input data-set="exclude" value="${esc(cfg.exclude)}" style="width:100%"></td></tr>
      </table>
      <h4>✎ Manage page</h4><table>
      <tr><td>Update prices on</td><td><select data-set="manageMode">
        ${opt('manageMode', 'all', 'All items')}
        ${opt('manageMode', 'undercut', 'Only items where I am undercut')}</select></td></tr>
      </table>
      <h4>⚙ API</h4><table>
      <tr><td>Fresh prices before filling</td><td><input type="checkbox" data-set="refreshBeforeFill" ${cfg.refreshBeforeFill ? 'checked' : ''}> <span class="hint">uses prices younger than the cache time, fetches the rest</span></td></tr>
      <tr><td>Reuse prices for (minutes)</td><td><input data-set="cacheMin" value="${cfg.cacheMin}" style="width:50px"></td></tr>
      <tr><td>Max Torn API calls per minute</td><td><input data-set="tornPerMin" value="${cfg.tornPerMin}" style="width:50px"> <span class="hint">limit is 100 for your whole account</span></td></tr>
      <tr><td>Bazaar prices from weav3r.dev</td><td><input type="checkbox" data-set="useWeav3r" ${cfg.useWeav3r ? 'checked' : ''}> <span class="hint">your key is never sent there</span></td></tr>
      </table>
      <p class="hint">The script only fills fields. You press «Save changes» / «Add to bazaar» yourself.</p>
      <button data-a="defaults">Restore default settings</button> <button data-a="reset">Clear item list</button></div>`;
  }

  function act(a, el) {
    if (a === 'close') document.getElementById('tbm').style.display = 'none';
    else if (a === 'refresh') refresh(false, true);
    else if (a === 'scan') refresh(true, false);
    else if (a === 'key') askKey();
    else if (a === 'fill') fillPage();
    else if (a === 'go-manage') location.href = 'https://www.torn.com/bazaar.php#/manage';
    else if (a === 'go-add') location.href = 'https://www.torn.com/bazaar.php#/add';
    else if (a === 'track' || a === 'trackall') {
      const list = a === 'track' ? [invAll[el.dataset.id]] : Object.values(invAll).filter(i => i.amount > 0 && !excluded(i.name) && !tracked[i.id]);
      for (const i of list) tracked[i.id] = { id: i.id, name: i.name, type: i.type, bzQty: 0, bzPrice: 0, inv: i.amount, floor: 0 };
      save('tracked', tracked); render();
      guard(async () => { let n = 0; for (const i of list) { n++; setStatus(`Prices ${n}/${list.length} …`); await fetchPrice(i.id); } setStatus(''); });
    }
    else if (a === 'forget') { if (confirm('Stop tracking this item?')) { delete tracked[el.dataset.id]; save('tracked', tracked); render(); } }
    else if (a === 'defaults') { cfg = Object.assign({}, DEF); save('cfg', cfg); render(); }
    else if (a === 'reset') { if (confirm('Clear the whole item list?')) { tracked = {}; priceCache = {}; save('tracked', tracked); save('prices', priceCache); render(); } }
  }

  build();
  setInterval(() => { build(); const w = document.getElementById('tbm'); if (w && w.style.display === 'flex') { const b = w.querySelector('[data-a=fill]'); const m = pageMode(); if (b && b.disabled === (m === 'manage' || m === 'add')) render(); } }, 2000);
})();
