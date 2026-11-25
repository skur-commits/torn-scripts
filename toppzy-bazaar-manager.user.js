// ==UserScript==
// @name         Toppzy Manager
// @namespace    toppzy.torn
// @version      0.3.4
// @description  Shopkeeper – bazaar manager for Torn: overview of everything in your bazaar (also sold-out items), price suggestions from Item Market + bazaars with an automatic safety floor (85 % of market, shop price, price paid abroad), prepare changes anywhere (even while flying) and apply them in Torn with one click. Only fills fields – you always press Save / Add yourself.
// @author       Toppzy [4422625]
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      weav3r.dev
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/skur-commits/torn-scripts/main/toppzy-bazaar-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/skur-commits/torn-scripts/main/toppzy-bazaar-manager.user.js
// @homepageURL  https://github.com/skur-commits/torn-scripts
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  const VERSION = '0.3.4';

  /* =====================================================================
   *  SETTINGS
   * ===================================================================*/
  const PRESETS = {
    fast:     { priceSource: 'lowestBoth', priceDelta: '-1', skipLowest: 0, minPctOfMV: 70 },
    balanced: { priceSource: 'lowestBoth', priceDelta: '-1', skipLowest: 1, minPctOfMV: 90 },
    profit:   { priceSource: 'market',     priceDelta: '-1', skipLowest: 0, minPctOfMV: 0 }
  };
  const DEF = Object.assign({
    preset: 'balanced',
    qtyMode: 'all',         // all | minus1 | leave | pct
    leaveQty: 1,
    pctQty: 50,
    neverSell: [],
    manageMode: 'all',      // all | undercut
    autoCheckMin: 15,       // 0 = off
    cacheMin: 10,
    tornPerMin: 40,
    useWeav3r: true,
    guardPct: 1,            // price guard: warn if market moved more than this %
    safetyPct: 85,          // 0.3.4: automatic floor = this % of market value (0 = off)
    view: 'simple'          // 0.3.4: simple | advanced
  }, PRESETS.balanced);
  const SRC = {
    lowestBoth: 'Cheapest seller anywhere (Item Market or bazaar)',
    lowestIM: 'Cheapest on the Item Market',
    lowestBazaar: 'Cheapest in bazaars',
    avgBazaar: 'Average bazaar price',
    market: 'Normal market price (market value)'
  };
  const UNIQUE_TYPES = ['Primary', 'Secondary', 'Melee', 'Defensive'];
  const ALL_CATS = ['Collectible', 'Clothing', 'Other', 'Tool', 'Melee', 'Defensive', 'Material', 'Car', 'Primary', 'Secondary', 'Book', 'Special', 'Supply Pack', 'Temporary', 'Enhancer', 'Artifact', 'Flower', 'Booster', 'Medical', 'Candy', 'Jewelry', 'Alcohol', 'Plushie', 'Drug', 'Energy Drink'];

  /* =====================================================================
   *  STORAGE
   * ===================================================================*/
  const hasGM = typeof GM_getValue === 'function';
  const load = (k, d) => { try { const v = hasGM ? GM_getValue(k) : localStorage.getItem('tbm_' + k); return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return d; } };
  const save = (k, v) => { try { hasGM ? GM_setValue(k, JSON.stringify(v)) : localStorage.setItem('tbm_' + k, JSON.stringify(v)); } catch (e) { } };

  let cfg = Object.assign({}, DEF, load('cfg', {}));
  if (!Array.isArray(cfg.neverSell)) cfg.neverSell = [];
  delete cfg.addWhich;                                                   // 0.3.1: Fill up always uses my list
  if ('exclude' in cfg) { delete cfg.exclude; delete cfg.strategy; cfg.preset = 'balanced'; Object.assign(cfg, PRESETS.balanced); save('cfg', cfg); } // 0.2 → 0.3
  let key = load('key', '');
  let me = load('me', 0);
  let items = load('items', null);
  if (!items) {                                   // migrate 0.2 "tracked"
    items = {};
    const old = load('tracked', {});
    for (const id in old) { const t = old[id]; items[id] = { id, name: t.name, type: t.type, bzQty: t.bzQty || 0, bzPrice: t.bzPrice || 0, inv: t.inv || 0, soldOutAt: t.soldOutAt || 0, floor: t.floor > 0 ? t.floor : null, custom: null, plan: {} }; }
  }
  if (load('ver', '') !== '0.3.4') {                // 0.3.4: Refill qty means «refill to N in total» (was «add N»)
    for (const id in items) { const p = items[id].plan; if (p && p.qty > 0) p.qty += items[id].bzQty || 0; }
    save('items', items); save('ver', '0.3.4');
  }
  let prices = load('prices', {});        // id -> {t, imList, bzList, bzAvg, mv, bzOk}
  let abroad = load('abroad', {});        // id -> {cost, t}
  let bazaar = load('bazaar', { open: null, t: 0 });
  let planBazaar = load('planBazaar', null);   // 'open' | 'close' | null
  let flow = load('flow', null);              // {steps:[...], i}
  let lastRun = load('lastRun', 0);
  const persist = () => { save('items', items); save('prices', prices); save('bazaar', bazaar); save('planBazaar', planBazaar); save('lastRun', lastRun); };

  /* =====================================================================
   *  HELPERS
   * ===================================================================*/
  const fmt = n => n ? '$' + Math.round(n).toLocaleString('en-US') : '–';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const num = v => +String(v == null ? '' : v).replace(/[^0-9.]/g, '') || 0;
  const minPos = arr => { const a = arr.filter(x => x > 0); return a.length ? Math.min(...a) : 0; };
  const nth = (list, n) => (list && list.length) ? list[Math.min(n, list.length - 1)] : 0;
  const isNever = name => cfg.neverSell.some(n => n.toLowerCase() === String(name || '').toLowerCase());
  const isUnique = it => UNIQUE_TYPES.includes(it.type) || !!it.unique;

  /* =====================================================================
   *  API
   * ===================================================================*/
  const ERR = {
    1: 'the key is empty', 2: 'the API key is wrong', 5: 'too many API calls – wait a minute',
    7: 'your key level is too low (use a Limited key)', 8: 'your IP is temporarily blocked by Torn',
    9: 'the Torn API is down', 10: 'the key owner is in federal jail', 13: 'the key is paused (inactive owner)',
    16: 'your key level is too low (use a Limited key)', 17: 'Torn backend error – try again'
  };
  let lastTorn = 0;
  async function torn(path, label) {
    const gap = 60000 / Math.max(5, +cfg.tornPerMin || 40);
    const wait = lastTorn + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastTorn = Date.now();
    let j;
    try {
      const r = await fetch(`https://api.torn.com/v2/${path}${path.includes('?') ? '&' : '?'}key=${key}&comment=ToppzyManager`);
      j = await r.json();
    } catch (e) { const er = new Error(`${label}: could not reach Torn (network)`); er.code = -1; throw er; }
    if (j.error) { const e = new Error(`${label}: ${ERR[j.error.code] || j.error.error}`); e.code = j.error.code; throw e; }
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

  async function ensureMe() {
    if (me) return me;
    const j = await torn('user/basic', 'Your profile');
    me = (j.profile || j).id || 0; save('me', me);
    return me;
  }
  async function fetchBazaar() {
    const j = await torn('user/bazaar', 'Your bazaar');
    const b = j.bazaar || {};
    bazaar = { open: b.exists === false ? null : !!b.is_open, t: Date.now() };
    if (planBazaar && ((planBazaar === 'open') === bazaar.open)) planBazaar = null;   // plan done
    // Torn's API returns an EMPTY item list while the bazaar is closed → keep the last known amounts (read from the Manage page)
    if (bazaar.open === false && !(b.items || []).length) return;
    const seen = new Set();
    for (const it of b.items || []) {
      const id = String(it.id); seen.add(id);
      const price = it.price || (it.uids && it.uids[0] && it.uids[0].price) || 0;
      const t = items[id] || (items[id] = { id, floor: null, custom: null, plan: {} });
      Object.assign(t, { name: it.name, type: it.type, bzQty: it.quantity, bzPrice: price, unique: !!(it.uids && it.uids.length), soldOutAt: 0 });
      t.plan = t.plan || {};
      if (t.plan.price && t.plan.price === price) { delete t.plan.price; delete t.plan.priceRef; delete t.plan.locked; }
    }
    for (const id in items) {
      const t = items[id];
      if (seen.has(id)) continue;
      if (t.plan && t.plan.remove) { delete items[id]; continue; }    // removal confirmed by API
      if (t.bzQty !== 0) { t.bzQty = 0; t.soldOutAt = Date.now(); }
    }
  }
  async function fetchInventory(cats) {
    const inv = {};
    for (const c of cats) {
      try {
        const j = await torn(`user/inventory?cat=${encodeURIComponent(c)}&limit=250`, 'Your inventory');
        for (const it of (j.inventory && j.inventory.items) || []) {
          if (it.equipped || it.faction_owned) continue;
          const id = String(it.id);
          inv[id] = inv[id] || { id, name: it.name, type: c, amount: 0 };
          inv[id].amount += it.amount;
        }
      } catch (e) { if ([2, 7, 16].includes(e.code)) throw e; }
    }
    return inv;
  }
  async function fetchPrice(id, force) {
    const c = prices[id];
    if (!force && c && Date.now() - c.t < cfg.cacheMin * 60000) return c;
    const p = { t: Date.now(), imList: [], bzList: [], bzAvg: 0, mv: 0, bzOk: false };
    try {
      const j = await torn(`market/${id}/itemmarket?limit=20`, 'Item Market prices');
      const m = j.itemmarket || {};
      p.imList = (m.listings || []).filter(x => x.price > 0).map(x => x.price).sort((a, b) => a - b).slice(0, 10);
      p.mv = +(m.item && m.item.average_price) || 0;
    } catch (e) { if ([2, 7, 16].includes(e.code)) throw e; }
    if (cfg.useWeav3r) {
      try {
        const w = await weav3r(id);
        p.bzList = (w.listings || []).filter(x => x.price > 0 && String(x.player_id) !== String(me)).map(x => x.price).sort((a, b) => a - b).slice(0, 10);
        p.bzAvg = +w.bazaar_average || 0;
        if (!p.mv && w.market_price) p.mv = +w.market_price;
        p.bzOk = true;
      } catch (e) { }
    }
    prices[id] = p;
    return p;
  }

  /* =====================================================================
   *  PRICING
   * ===================================================================*/
  const strategyOf = it => (it && it.custom) ? it.custom : cfg;
  function basePrice(p, s) {
    const n = +s.skipLowest || 0;
    const im = nth(p.imList, n), bz = nth(p.bzList, n);
    switch (s.priceSource) {
      case 'lowestIM': return im || bz;
      case 'lowestBazaar': return bz || im;
      case 'avgBazaar': return p.bzAvg || p.mv;
      case 'market': return p.mv;
      default: return minPos([im, bz]);
    }
  }
  function applyDelta(v, d) {
    const m = String(d).replace(/\s|\$/g, '').match(/^([+-]?\d+(?:\.\d+)?)(%?)$/);
    if (!m || !v) return v;
    return m[2] ? v * (1 + (+m[1]) / 100) : v + (+m[1]);
  }
  // floor = never sell below. Manual per item (0 = off), else the highest of:
  // safety % of market value · what Torn's shops pay (sell price) · price paid abroad
  const mvOf = it => ((invValues[it.id] && invValues[it.id].mp) || (prices[it.id] && (prices[it.id].mv || prices[it.id].bzAvg)) || 0);
  const shopOf = it => (invValues[it.id] && invValues[it.id].sell) || 0;
  function floorInfo(it) {
    if (!it) return { v: 0, why: '' };
    if (it.floor === 0) return { v: 0, why: 'off' };
    if (it.floor > 0) return { v: it.floor, why: 'manual' };
    const c = [];
    const pct = +cfg.safetyPct || 0, mv = mvOf(it);
    if (pct && mv && !isUnique(it)) c.push({ v: Math.round(mv * pct / 100), why: `${pct} % of market` });
    if (shopOf(it)) c.push({ v: shopOf(it), why: 'shop price' });
    if (abroad[it.id] && abroad[it.id].cost) c.push({ v: abroad[it.id].cost, why: 'bought abroad' });
    return c.reduce((a, b) => b.v > a.v ? b : a, { v: 0, why: '' });
  }
  const floorOf = it => floorInfo(it).v;
  const lowPrice = it => { const pl = it.plan || {}, f = floorOf(it); return !!(pl.price && f && pl.price < f); };
  function suggest(it, p) {
    if (!p || isUnique(it)) return 0;
    const s = strategyOf(it);
    let v = Math.round(applyDelta(basePrice(p, s), s.priceDelta));
    if (+s.minPctOfMV && p.mv && v < p.mv * s.minPctOfMV / 100) v = Math.round(p.mv * s.minPctOfMV / 100);
    const f = floorOf(it);
    if (f && v < f) v = f;
    return v > 0 ? v : 0;
  }
  const lowestOther = p => p ? minPos([nth(p.imList, 0), nth(p.bzList, 0)]) : 0;
  function status(it) {
    const p = prices[it.id];
    if (it.bzQty > 0 && bazaar && bazaar.open === false) return { k: 'closed', txt: 'Bazaar closed', col: '#999' };
    const shop = shopOf(it), lo0 = lowestOther(p);
    if (!isUnique(it) && shop && lo0 && lo0 <= shop && (it.bzQty > 0 || it.inv > 0)) return { k: 'shop', txt: `Sell to shop ${fmt(shop)}`, col: '#b48ae0' };
    if (!it.bzQty) return { k: 'sold', txt: 'Sold out' + (it.inv > 0 ? ` · ${it.inv} in inv` : '') + (it.soldOutAt ? ` · ${ago(it.soldOutAt)}` : ''), col: '#3d85c6' };
    if (isUnique(it)) return { k: 'ok', txt: 'Manual price', col: '#999' };
    const lo = lowestOther(p);
    if (lo && it.bzPrice > lo) return { k: 'under', txt: 'Undercut', col: '#e6b800' };
    if (lo) return { k: 'ok', txt: 'Lowest', col: '#6aa84f' };
    return { k: 'ok', txt: '–', col: '#555' };
  }

  /* =====================================================================
   *  PLAN
   * ===================================================================*/
  const P = it => (it.plan = it.plan || {});
  // Refill to N = N in the bazaar in total → how many to add now
  const addOf = (it, have) => { const pl = it.plan || {}; if (!(pl.qty > 0)) return 0; const h = have == null ? (it.inv || 0) : have; return Math.max(0, Math.min(pl.qty - (it.bzQty || 0), h)); };
  function planCounts() {
    let price = 0, qty = 0, rem = 0, priceOut = 0, priceNoQty = 0;
    for (const id in items) {
      const it = items[id], p = it.plan || {};
      if (p.price) { price++; if (it.bzQty > 0) priceOut++; else if (!(addOf(it) > 0)) priceNoQty++; }
      if (addOf(it) > 0) qty++; if (p.remove) rem++;
    }
    return { price, qty, rem, priceOut, priceNoQty, bz: planBazaar ? 1 : 0, total: price + qty + rem + (planBazaar ? 1 : 0) };
  }
  function setPlanPrice(it, v, locked) {
    const p = P(it);
    if (!v) { delete p.price; delete p.locked; delete p.priceRef; return; }
    p.price = Math.round(v); p.locked = !!locked; p.priceRef = lowestOther(prices[it.id]) || 0; p.t = Date.now();
  }
  function qtyFor(have, it) {
    if (it && it.plan && it.plan.qty > 0) return addOf(it, have);
    if (cfg.qtyMode === 'minus1') return have - 1;
    if (cfg.qtyMode === 'leave') return have - (+cfg.leaveQty || 0);
    if (cfg.qtyMode === 'pct') return Math.floor(have * (+cfg.pctQty || 0) / 100);
    return have;
  }
  function fillScope() {
    return Object.values(items).filter(it => !isNever(it.name) && !(it.plan && it.plan.remove) && status(it).k !== 'shop');
  }

  /* =====================================================================
   *  REFRESH
   * ===================================================================*/
  let busy = false, invAll = null;
  async function guard(fn) {
    for (let i = 0; i < 150 && busy; i++) await sleep(200);          // wait for a running refresh instead of silently doing nothing
    if (busy) { toast('Still loading – try again in a moment.', true); return false; }
    if (!key) { askKey(); return false; }
    busy = true; let ok = true;
    try { await ensureMe(); await fn(); }
    catch (e) {
      ok = false;
      if (e.code === 2) { key = ''; save('key', ''); toast(e.message, true); askKey(); }
      else toast(e.message, true);
    }
    busy = false; persist(); render(); return ok;
  }
  const refresh = (scanAll, force) => guard(async () => {
    setStatus('Loading your bazaar …');
    await fetchBazaar();
    const cats = scanAll ? ALL_CATS : [...new Set(Object.values(items).map(t => t.type).filter(Boolean))];
    setStatus(`Loading inventory (${cats.length} categories) …`);
    const inv = await fetchInventory(cats);
    for (const id in items) items[id].inv = inv[id] ? inv[id].amount : 0;
    setStatus('Loading market values and shop prices …');
    await fetchInvValues([...new Set([...Object.keys(items), ...(scanAll ? Object.keys(inv) : [])])]);
    if (scanAll) invAll = inv;
    const ids = Object.keys(items); let i = 0;
    for (const id of ids) { i++; setStatus(`Prices ${i}/${ids.length} …`); await fetchPrice(id, force); }
    lastRun = Date.now(); save('lastAuto', Date.now()); setStatus('');
  });
  async function autoCheck() {
    if (!key || busy || !(+cfg.autoCheckMin)) return;
    const last = load('lastAuto', 0);
    if (Date.now() - last < cfg.autoCheckMin * 60000) return;
    save('lastAuto', Date.now());
    busy = true;
    try {
      await ensureMe(); await fetchBazaar();
      const cats = [...new Set(Object.values(items).map(t => t.type).filter(Boolean))];
      const inv = await fetchInventory(cats);
      for (const id in items) items[id].inv = inv[id] ? inv[id].amount : 0;
    } catch (e) { }
    busy = false; persist(); render();
  }

  /* =====================================================================
   *  TORN PAGES – read & fill (never saves)
   * ===================================================================*/
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function setVal(input, v) {
    if (!input) return;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setMoney(container, v) {
    const vis = container.querySelector('input.input-money:not([type=hidden])');
    const hid = container.querySelector('input.input-money[type=hidden]');
    if (vis) { vis.focus(); setVal(vis, Math.round(v)); vis.blur(); }
    if (hid) setVal(hid, Math.round(v));
  }
  const pageMode = () => /bazaar\.php/.test(location.href) ? (/#\/manage/.test(location.hash) ? 'manage' : /#\/add/.test(location.hash) ? 'add' : /#\/personali[sz]e/.test(location.hash) ? 'personalize' : 'bazaar') : '';
  const idFromImg = el => { const img = el && el.querySelector('img[src*="/images/items/"]'); return img ? (img.getAttribute('src').match(/items\/(\d+)\//) || [])[1] : null; };
  const mark = (row, col) => { row.style.outline = '2px solid ' + col; row.style.outlineOffset = '-2px'; };

  // ---- Manage page
  function manageRows() {
    return [...document.querySelectorAll('[data-testid^="item-"]')].map(row => {
      const id = idFromImg(row);
      const price = row.querySelector('[class*="price___"]');
      const remove = row.querySelector('input[class*="removeAmountInput"], [class*="remove___"] input');
      return id && price ? { id, price, remove, row } : null;
    }).filter(Boolean);
  }
  // read amounts and prices straight from Torn's Manage page (works also while the bazaar is closed)
  function readManage() {
    const rows = manageRows(); if (!rows.length) return 0;
    const seen = new Set(); let ch = 0;
    for (const x of rows) {
      seen.add(x.id);
      const txt = x.row.innerText || '';
      const qty = num((txt.match(/\bx\s?([\d,]+)/) || [])[1]);
      const name = ((txt.split('\n').find(l => /\bx\s?[\d,]+/.test(l)) || '').replace(/\s*x\s?[\d,]+.*$/, '')).trim();
      const hid = x.price.querySelector('input.input-money[type=hidden]'), vis = x.price.querySelector('input.input-money:not([type=hidden])');
      const pr = num((hid && hid.value) || (vis && vis.value) || '');
      if (!qty) continue;
      const t = items[x.id] || (items[x.id] = { id: x.id, name: name || x.id, floor: null, custom: null, plan: {} });
      if (!t.name || t.name === x.id) t.name = name || t.name;
      if (t.bzQty !== qty || (pr && !t.bzPrice)) ch++;
      t.bzQty = qty; if (pr && !(x.price.dataset.tbmTouched)) t.bzPrice = pr; t.soldOutAt = 0;
    }
    for (const id in items) { const t = items[id]; if (!seen.has(id) && t.bzQty > 0) { t.bzQty = 0; t.soldOutAt = Date.now(); ch++; } }
    if (ch) { persist(); render(); }
    return ch;
  }
  let lastManageRead = 0;
  async function watchManage() {
    if (pageMode() !== 'manage' || Date.now() - lastManageRead < 1500) return;
    lastManageRead = Date.now();
    for (let i = 0; i < 20 && !manageRows().length; i++) await sleep(250);
    readManage();
  }
  // mode: 'plan' (prices + removals from the plan) | 'adjust' (suggested prices now)
  function fillManage(mode) {
    let n = 0, r = 0;
    for (const x of manageRows()) {
      const it = items[x.id]; if (!it) continue;
      const pl = it.plan || {};
      if (pl.remove && x.remove) { setVal(x.remove, it.bzQty || num((x.row.innerText.match(/x\s?([\d,]+)/) || [])[1]) || 1); mark(x.row, '#cc0000'); r++; continue; }
      let v = 0;
      if (mode === 'plan') v = pl.price || 0;
      else {
        if (pl.locked && pl.price) v = pl.price;
        else if (isUnique(it)) v = 0;
        else if (cfg.manageMode === 'undercut' && status(it).k !== 'under') v = 0;
        else v = suggest(it, prices[it.id]);
      }
      if (!v || v === it.bzPrice) continue;
      setMoney(x.price, v); x.price.dataset.tbmTouched = '1'; mark(x.row, '#6aa84f'); n++;
    }
    return { n, r };
  }

  // ---- Add items page (loads the "All" tab first – items only load when a tab is clicked)
  async function addRows() {
    const tabs = [...document.querySelectorAll('ul.ui-tabs-nav li a')];
    const allTab = tabs.find(a => /^\s*all\s*$/i.test(a.getAttribute('title') || a.getAttribute('data-title') || a.textContent || '')) || tabs[0];
    if (allTab && !/active/.test(allTab.closest('li').className)) allTab.click();
    const rowsNow = () => [...document.querySelectorAll('ul.all-items li[data-group="child"]')].filter(li => idFromImg(li));
    for (let i = 0; i < 40 && !rowsNow().length; i++) await sleep(250);
    return rowsNow().map(li => {
      const id = idFromImg(li);
      const txt = li.innerText || '';
      if (/Equipped|Untradable/i.test(txt)) return null;
      const qty = li.querySelector('.amount input:not([type=hidden])');
      const box = li.querySelector('input[type=checkbox]');
      const hasPrice = !!li.querySelector('input.input-money');
      const nameEl = li.querySelector('.name-wrap, .t-overflow');
      const raw = (nameEl ? nameEl.innerText : txt.split('\n')[0]).trim();
      const name = raw.replace(/\s*x[\d,]+\s*$/, '').trim();
      const have = num((raw.match(/x\s?([\d,]+)\s*$/) || [])[1]) || 1;
      return { id, li, qty, box, hasPrice, name, have };
    }).filter(Boolean);
  }
  // mode: 'plan' (pending refills) | 'fill' (Fill all settings)
  let addFilled = [];
  function applyAddFilled() {           // after ADD TO BAZAAR: count the added items as in the bazaar right away
    for (const f of addFilled) {
      const t = items[f.id] || (items[f.id] = { id: f.id, name: f.name, type: f.type, floor: null, custom: null, plan: {} });
      t.bzQty = (t.bzQty || 0) + f.q; if (!t.bzPrice || !(t.bzQty - f.q)) t.bzPrice = f.pr; t.soldOutAt = 0;
      if (t.inv > 0) t.inv = Math.max(0, t.inv - f.q);
    }
    addFilled = [];
  }
  async function fillAdd(mode) {
    addFilled = [];
    const rows = await addRows();
    let n = 0, skipped = 0;
    for (const r of rows) {
      const it = items[r.id] || { id: r.id, name: r.name, type: '', floor: null, plan: {} };
      if (isNever(it.name || r.name)) continue;
      let q;
      if (mode === 'plan') { if (!(it.plan && it.plan.qty > 0)) continue; q = addOf(it, r.have); }
      else {
        if (!items[r.id]) continue;                         // Fill all = only items in my list
        if (it.plan && it.plan.remove) continue;
        if (status(it).k === 'shop' && !(it.plan && it.plan.qty > 0)) continue;   // a shop pays more – sell it there
        q = qtyFor(r.have, it);
      }
      if (!(q > 0)) { skipped++; continue; }
      // already for sale → keep the bazaar's current price (prices are changed with Adjust prices); new/empty → suggestion
      const pr = (it.plan && it.plan.price) || (it.bzQty > 0 ? it.bzPrice : 0) || suggest(it, prices[r.id]) || it.bzPrice || 0;
      if (!pr) { skipped++; continue; }                     // no price known (e.g. weapon without plan)
      if (r.qty) { r.qty.focus(); setVal(r.qty, q); r.qty.blur(); }
      else if (r.box) { if (!r.box.checked) r.box.click(); }
      else { skipped++; continue; }
      if (r.hasPrice) setMoney(r.li, pr);
      addFilled.push({ id: r.id, name: it.name || r.name, type: it.type || '', q, pr });
      mark(r.li, '#3d85c6'); n++;
    }
    return { n, skipped };
  }

  // ---- Personalize page
  function fillPersonalize(want) {
    const radios = [...document.querySelectorAll('input[type=radio]')];
    const labelOf = r => ((r.labels && r.labels[0] && r.labels[0].textContent) || (document.querySelector(`label[for="${r.id}"]`) || {}).textContent || r.value || '');
    const pick = radios.find(r => want === 'open' ? /open/i.test(labelOf(r)) : /clos/i.test(labelOf(r)));
    if (!pick) return false;
    pick.click();
    const btn = [...document.querySelectorAll('button, input[type=submit], a')].find(b => /change details/i.test(b.textContent || b.value || ''));
    if (btn) { btn.style.outline = '3px solid #e6b800'; btn.scrollIntoView({ block: 'center' }); }
    return true;
  }

  // ---- Abroad shop: remember purchase prices (auto floor). Best effort – verified on next trip.
  function captureAbroad() {
    const onTravel = /sid=travel/.test(location.href) || (/\/index\.php/.test(location.pathname) && /in stock/i.test((document.querySelector('#mainContainer, .content-wrapper') || document.body).innerText || ''));
    if (!onTravel) return;
    let n = 0;
    document.querySelectorAll('img[src*="/images/items/"]').forEach(img => {
      if (img.closest('#tbm')) return;
      const id = (img.getAttribute('src').match(/items\/(\d+)\//) || [])[1]; if (!id) return;
      let row = img;
      for (let i = 0; i < 6 && row && !(/\$\s?[\d,]+/.test(row.innerText || '') && /buy/i.test(row.innerText || '')); i++) row = row.parentElement;
      if (!row || !/buy/i.test(row.innerText || '') || !/stock|in stock|cost/i.test(row.innerText || '')) return;
      const cost = num(((row.innerText || '').match(/\$\s?([\d,]{1,})/) || [])[1]);
      if (cost > 0) { abroad[id] = { cost, t: Date.now() }; n++; }
    });
    if (n) save('abroad', abroad);
  }

  /* =====================================================================
   *  ACTIONS
   * ===================================================================*/
  const GO = { manage: 'https://www.torn.com/bazaar.php#/manage', add: 'https://www.torn.com/bazaar.php#/add', personalize: 'https://www.torn.com/bazaar.php#/personalize' };
  function go(step) { if (pageMode() === step) runFlowStep(); else location.href = GO[step]; }

  // put suggested prices in the plan (Change price, «auto») – also for empty items. onlyEmpty: used on the Manage page
  function planPrices(onlyEmpty) {
    let n = 0;
    for (const it of Object.values(items)) {
      if (isUnique(it) || (it.plan && it.plan.locked) || (it.plan && it.plan.remove)) continue;
      if (onlyEmpty && it.bzQty) continue;
      if (it.bzQty && cfg.manageMode === 'undercut' && status(it).k !== 'under') continue;
      const v = suggest(it, prices[it.id]);
      if (!v) continue;
      if (it.bzQty && v === it.bzPrice) { if (it.plan && it.plan.price && !it.plan.locked) setPlanPrice(it, 0); continue; }
      setPlanPrice(it, v, false); n++;
    }
    return n;
  }
  // 💲 Adjust all prices
  async function actAdjust() {
    if (!key) return askKey();
    if (pageMode() === 'manage') {
      await guard(async () => { const ids = manageRows().map(r => r.id).filter(id => items[id]); let i = 0; for (const id of ids) { i++; setStatus(`Prices ${i}/${ids.length} …`); await fetchPrice(id, false); } setStatus(''); });
      const { n } = fillManage('adjust');
      const e = planPrices(true); persist(); render();
      hookSave(/save changes/i, () => { });
      return toast((n ? `${n} prices filled – ${SAVE_TXT.manage}.` : 'All prices on this page are already right.') + (e ? ` ${e} empty items got a new price.` : ''));
    }
    const n = planPrices(false);
    persist(); render();
    toast(n ? `${n} price changes ready – press ▶ Apply when you're in Torn.` : 'No price changes needed.');
  }
  // 📦 Fill all items
  async function actFill() {
    if (!key) return askKey();
    if (pageMode() === 'add') {
      const { n, skipped } = await fillAdd('fill');
      hookSave(/add to bazaar/i, applyAddFilled);
      return toast(n ? `${n} items filled${skipped ? `, ${skipped} skipped` : ''} – ${SAVE_TXT.add}.` : 'Nothing to fill with your current settings.');
    }
    let n = 0;
    for (const it of fillScope()) {
      const q = qtyFor(it.inv || 0, Object.assign({}, it, { plan: {} }));
      if (q > 0) { P(it).qty = (it.bzQty || 0) + q; n++; }
    }
    persist(); render();
    toast(n ? `${n} refills ready – press ▶ Apply when you're in Torn.` : 'Nothing in your inventory to fill with.');
  }
  // ▶ Apply
  async function isTraveling() {
    if (/unavailable while you('|’)re traveling/i.test(document.body.innerText || '')) return true;
    try { const j = await torn('user/basic', 'Your status'); const st = ((j.profile || {}).status || {}).state || ''; return /travel|abroad/i.test(st); } catch (e) { return false; }
  }
  const TRAVEL_MSG = "You're traveling – your changes are saved. Apply them when you're back in Torn.";
  async function actApply(lowOk) {
    const c = planCounts();
    if (!c.total) return toast('No changes to apply.');
    if (!key) return askKey();
    if (!lowOk) {                                   // price below floor → confirm first (one click in the panel, nothing in Torn)
      const low = Object.values(items).filter(it => lowPrice(it) && !(it.plan && it.plan.remove));
      if (low.length) { lowState = { items: low }; guardState = null; openPanel(); return; }
    }
    lowState = null;
    if (await isTraveling()) return toast(TRAVEL_MSG, true);
    const steps = [];
    if (c.priceOut || c.rem) steps.push('manage');          // prices on items for sale + removals
    if (c.qty) steps.push('add');                            // refills (empty items use their planned price here)
    if (c.bz) steps.push('personalize');
    const warn = c.priceNoQty ? `${c.priceNoQty} empty item${c.priceNoQty > 1 ? 's have' : ' has'} a price but no refill amount – press 📦 Fill all or set Refill to.` : '';
    if (!steps.length) return toast(warn || 'Nothing to apply.', true);
    if (warn) toast(warn, true);
    applyNote = warn;
    if (c.price) {                                  // price guard
      const ok = await guard(async () => {
        const ids = Object.keys(items).filter(id => items[id].plan && items[id].plan.price); let i = 0;
        for (const id of ids) { i++; setStatus(`Checking prices ${i}/${ids.length} …`); await fetchPrice(id, true); }
        setStatus('');
      });
      if (!ok) return;
      const moved = Object.values(items).filter(it => {
        const pl = it.plan || {}; if (!pl.price || !pl.priceRef) return false;
        const now = lowestOther(prices[it.id]);
        return now && Math.abs(now - pl.priceRef) / pl.priceRef * 100 > (+cfg.guardPct || 1);
      });
      if (moved.length) { showGuard(moved, steps); return; }
    }
    startFlow(steps);
  }
  let applyNote = '';
  function startFlow(steps) { flow = { steps, i: 0, note: applyNote || '' }; applyNote = ''; save('flow', flow); render(); go(steps[0]); }
  let flowRunning = false;
  async function runFlowStep() {
    if (!flow || flowRunning) return;
    const step = flow.steps[flow.i];
    if (pageMode() !== step) { render(); return; }
    flowRunning = true;
    await sleep(800);
    if (/unavailable while you('|’)re traveling/i.test(document.body.innerText || '')) { flowRunning = false; flow = null; save('flow', null); openPanel(); toast(TRAVEL_MSG, true); return; }
    let msgTxt = '';
    if (step === 'manage') {
      for (let i = 0; i < 20 && !manageRows().length; i++) await sleep(250);
      const { n, r } = fillManage('plan');
      msgTxt = `Step ${flow.i + 1}/${flow.steps.length}: ${n} prices${r ? ` and ${r} removals` : ''} filled – ${SAVE_TXT.manage}.`;
      hookSave(/save changes/i, () => { for (const it of Object.values(items)) if (it.plan && it.bzQty > 0) { delete it.plan.price; delete it.plan.locked; delete it.plan.priceRef; } }, true);
    } else if (step === 'add') {
      const { n } = await fillAdd('plan');
      msgTxt = `Step ${flow.i + 1}/${flow.steps.length}: ${n} items filled – ${SAVE_TXT.add}.`;
      hookSave(/add to bazaar/i, () => { applyAddFilled(); for (const it of Object.values(items)) if (it.plan && it.plan.qty) { delete it.plan.qty; if (!it.bzQty) { delete it.plan.price; delete it.plan.locked; delete it.plan.priceRef; } } }, true);
    } else if (step === 'personalize') {
      for (let i = 0; i < 20 && !document.querySelector('input[type=radio]'); i++) await sleep(250);
      const ok = fillPersonalize(planBazaar);
      msgTxt = ok ? `Step ${flow.i + 1}/${flow.steps.length}: bazaar set to ${planBazaar === 'open' ? 'OPEN' : 'CLOSED'} – ${SAVE_TXT.personalize}.` : 'Could not find the Open/Closed choice on this page.';
      hookSave(/change details/i, () => { bazaar.open = planBazaar === 'open'; planBazaar = null; }, true);
    }
    flowRunning = false;
    openPanel(); toast(msgTxt + (flow && flow.note ? ' ⚠ ' + flow.note : ''), !!(flow && flow.note));
  }
  const SAVE_TXT = { manage: "press Torn's SAVE CHANGES button (top left of the bazaar list)", add: "press Torn's ADD TO BAZAAR button (top of the list)", personalize: "press Torn's «change details» button (bottom of the form)" };
  function markSave(re) {
    const btn = [...document.querySelectorAll('button, input[type=submit], a')].find(b => re.test(b.textContent || b.value || '') && !b.closest('#tbm'));
    if (btn) { btn.style.outline = '3px solid #e6b800'; btn.style.outlineOffset = '2px'; btn.scrollIntoView({ block: 'center' }); }
  }
  // ---- one click in the panel = one press of Torn's own button (Torn rule: one input = one action)
  const SAVE_RE = { manage: /save changes/i, add: /add to bazaar/i, personalize: /change details/i };
  const SAVE_BTN = { manage: '💾 SAVE CHANGES', add: '➕ ADD TO BAZAAR', personalize: '✔ CHANGE DETAILS' };
  let pendingSave = null;
  const tornBtn = re => [...document.querySelectorAll('button, input[type=submit], a')].find(b => re.test(b.textContent || b.value || '') && !b.closest('#tbm'));
  function pressTorn() {
    const step = pageMode(), re = SAVE_RE[step];
    if (!re || pendingSave !== step) return;
    const btn = tornBtn(re);
    if (!btn) return toast("Could not find Torn's button on this page.", true);
    if (btn.disabled || /disabled/.test(btn.className || '')) return toast("Torn's button is not active – nothing has changed on this page.", true);
    pendingSave = null; render();
    btn.click();
  }
  function hookSave(re, done, isFlow) {
    markSave(re);
    const btn = tornBtn(re);
    if (!btn) return;
    pendingSave = pageMode(); setTimeout(render, 0);
    if (isFlow) { if (btn.dataset.tbmFlow === String(flow && flow.i)) return; btn.dataset.tbmFlow = String(flow && flow.i); }
    const step = pageMode();
    btn.addEventListener('click', () => {
      pendingSave = null;
      done(); persist();
      if (isFlow && flow) { flow.i++; if (flow.i >= flow.steps.length) flow = null; save('flow', flow); }
      // update automatically: Manage page is read again, and the API is asked again (Torn caches it ~30 s)
      if (step === 'manage') setTimeout(() => { document.querySelectorAll('[data-tbm-touched]').forEach(e => delete e.dataset.tbmTouched); lastManageRead = 0; watchManage(); }, 2500);
      setTimeout(() => { save('lastAuto', 0); refresh(false, false); }, 3000);
      setTimeout(() => { if (!busy) refresh(false, false); }, 35000);
      render();
    }, { once: true });
  }
  function nextStep() { if (flow) go(flow.steps[flow.i]); }
  function cancelFlow() { flow = null; save('flow', null); render(); }

  // 🔓 / 🔒
  function actBazaar(want) {
    planBazaar = want; save('planBazaar', planBazaar);
    if (pageMode() === 'personalize') {
      fillPersonalize(want) ? toast(`Set to ${want === 'open' ? 'OPEN' : 'CLOSED'} – ${SAVE_TXT.personalize}.`) : toast('Could not find the Open/Closed choice.', true);
      hookSave(/change details/i, () => { bazaar.open = want === 'open'; planBazaar = null; });
      return;
    }
    if (!location.hostname.includes('torn.com')) return;
    startFlow(['personalize']);
  }
  // ✕ remove item completely
  function actRemove(id) {
    const it = items[id]; if (!it) return;
    if (!it.bzQty) { delete items[id]; if (openCard === id) openCard = null; persist(); render(); toast(`${it.name} removed from the list.`); return; }
    if (!confirm(`Remove all ${it.bzQty} ${it.name} from your bazaar and from the list?`)) return;
    P(it).remove = true; delete it.plan.price; delete it.plan.qty;
    persist();
    if (pageMode() === 'manage') { const { r } = fillManage('plan'); hookSave(/save changes/i, () => { });  toast(r ? `Remove field filled – ${SAVE_TXT.manage}.` : 'Could not find the item on this page.'); }
    else toast(`${it.name} will be removed when you press ▶ Apply.`);
    render();
  }

  /* =====================================================================
   *  UI
   * ===================================================================*/
  const CSS = `
  #tbm-btn{position:relative;background:#8b0000 !important;color:#fff !important}
  #tbm-btn:hover{background:#b00000 !important}
  #tbm-btn svg{stroke:#fff !important;fill:none !important;color:#fff !important}
  #tbm-btn svg *{stroke:#fff !important}
  #tbm-btn .tbm-badge{position:absolute;top:-6px;right:-6px;background:#cc0000;color:#fff;border:1.5px solid #fff;border-radius:9px;font:bold 10px/13px Arial;padding:0 4px;min-width:14px;text-align:center;display:none;z-index:2}
  #tbm-btn.tbm-float{position:fixed;right:14px;bottom:130px;z-index:999999;width:44px;height:44px;border-radius:50%;border:2px solid #fff;cursor:pointer;box-shadow:0 2px 10px #000a;display:flex;align-items:center;justify-content:center}
  #tbm{position:fixed;right:8px;bottom:46px;z-index:999999;width:960px;max-width:calc(100vw - 16px);max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#1b1b1b;color:#ddd;font:12px/1.35 Arial,sans-serif;border:2px solid #6aa84f;border-radius:8px;box-shadow:0 6px 20px #000c;text-align:left}
  #tbm.tbm-floatpos{bottom:185px;max-height:calc(100vh - 200px)}
  #tbm *{box-sizing:border-box}
  #tbm header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #333;flex-wrap:wrap}
  #tbm header .ttl{font-size:14px;color:#fff;font-weight:bold}
  #tbm header .ver{color:#777;font-size:11px}
  #tbm header .ad{color:#888;font-size:10px;margin-right:auto}
  #tbm header .ad a{color:#8ab4f8}
  #tbm button.rf{border-color:#6aa84f;display:inline-flex;align-items:center;gap:4px}
  #tbm .rfi{font-size:19px;line-height:14px;color:#fff;font-weight:bold}
  #tbm .bz{padding:1px 7px;border-radius:9px;font-size:11px;color:#000;font-weight:bold}
  #tbm button{background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:12px Arial,sans-serif;cursor:pointer;white-space:nowrap;height:auto;line-height:1.3}
  #tbm button:hover{border-color:#999}
  #tbm button:disabled{opacity:.45;cursor:default}
  #tbm button.g{background:#38761d;border-color:#6aa84f}
  #tbm button.bl{background:#0b3d6b;border-color:#3d85c6}
  #tbm button.y{background:#7f6000;border-color:#e6b800}
  #tbm button.r{background:#5b0f00;border-color:#cc0000}
  #tbm button.on{border-color:#6aa84f;box-shadow:0 0 0 1px #6aa84f inset;background:#274e13}
  #tbm .bar{display:flex;gap:5px;padding:6px 9px;border-bottom:1px solid #333;flex-wrap:wrap;align-items:center}
  #tbm .bar .sp{margin-left:auto}
  #tbm .flow .big{font-size:13px;font-weight:bold;padding:5px 12px}
  #tbm .flow{background:#3d3400;color:#ffe599;padding:6px 9px;border-bottom:1px solid #7f6000;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  #tbm .body{overflow:auto;padding:4px 9px 8px;flex:1;min-height:0}
  #tbm table{width:100%;border-collapse:collapse;font:12px Arial,sans-serif}
  #tbm th,#tbm td{color:#ddd !important;background:transparent}
  #tbm th{position:sticky;top:0;background:#1b1b1b !important;text-align:left;color:#999 !important;font-weight:normal;padding:4px 3px;border-bottom:1px solid #444;z-index:1}
  #tbm td{padding:4px 3px;border-bottom:1px solid #2c2c2c;vertical-align:middle}
  #tbm td.n,#tbm th.n{text-align:right;white-space:nowrap}
  #tbm tr.planned td{background:#1e2a1a !important}
  #tbm tr.removing td{background:#2a1515 !important}
  #tbm .st{display:inline-block;padding:1px 6px;border-radius:9px;color:#000 !important;font-size:11px;white-space:nowrap}
  #tbm input,#tbm select{background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:3px 5px;font:12px Arial,sans-serif;height:auto}
  #tbm input.cp{width:92px;text-align:right}
  #tbm input.cp.set{border-color:#6aa84f;color:#b6d7a8}
  #tbm input.pq{width:52px;text-align:right}
  #tbm a{color:#8ab4f8;cursor:pointer;text-decoration:none}
  #tbm a.gear{color:#777;font-size:14px}
  #tbm a.gear.custom{color:#6aa84f}
  #tbm .mini{border:0 !important;background:none !important;padding:0 3px !important;color:#8ab4f8 !important;font-size:13px !important}
  #tbm .card td{background:#222 !important;padding:8px 10px}
  #tbm .card .grid{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
  #tbm .card label{display:block;color:#999;font-size:11px;margin-bottom:2px}
  #tbm .set h4{margin:12px 0 4px;color:#6aa84f;font-size:12px}
  #tbm .set .q{margin:6px 0;color:#ddd}
  #tbm .set .q>div:first-child{color:#ccc;margin-bottom:3px}
  #tbm .hint{color:#999;font-size:11px}
  #tbm .info{color:#8ab4f8;cursor:help;margin-left:3px}
  #tbm .presets{display:flex;gap:6px;flex-wrap:wrap}
  #tbm .presets button{padding:6px 10px}
  #tbm .example{background:#222;border:1px solid #333;border-radius:4px;padding:6px 8px;margin:6px 0;color:#ddd}
  #tbm .chip{display:inline-block;background:#333;border-radius:10px;padding:2px 8px;margin:2px;color:#ddd}
  #tbm .chip a{color:#e06666;margin-left:4px}
  #tbm details{margin-top:10px}
  #tbm summary{cursor:pointer;color:#bbb}
  #tbm .danger{border:1px solid #cc0000;border-radius:4px;padding:8px;margin-top:12px}
  #tbm .danger h4{color:#e06666 !important;margin-top:0}
  #tbm .foot{padding:5px 9px;border-top:1px solid #333;color:#999;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  #tbm .msg{color:#ffd966}
  #tbm .msg.err{color:#ea9999}
  #tbm .modal td{background:#2a2400 !important}
  #tbm .seg{display:inline-flex;border:1px solid #555;border-radius:4px;overflow:hidden}
  #tbm .seg button{border:0 !important;border-radius:0}
  #tbm .seg button.on{box-shadow:none}
  #tbm button.ico{padding:4px 7px}
  #tbm .sug{border:1px solid #3d85c6 !important;background:#0b2a4a !important;color:#9fc5e8 !important;border-radius:3px;padding:2px 6px !important;font-size:11px !important}
  #tbm .max{padding:2px 6px !important;font-size:11px !important}
  #tbm .add{color:#b6d7a8;font-size:11px;margin-left:3px}
  #tbm input.cp.low{border-color:#e06666 !important;color:#ea9999 !important}
  #tbm .lowtxt{color:#ea9999;font-size:11px}
  #tbm .lock{cursor:help}
  @media (max-width:700px){
    #tbm{right:4px;left:4px;width:auto;max-width:none;bottom:50px;max-height:calc(100vh - 90px)}
    #tbm .opt{display:none}
    #tbm button{padding:7px 9px;font-size:13px}
    #tbm input.cp{width:78px}
    #tbm header .ad{width:100%;order:9}
    #tbm table.simple .st{font-size:0;width:12px;height:12px;padding:0;border-radius:50%}
    #tbm table.simple th.stc{font-size:0}
    #tbm table.simple .add{display:block;margin:0}
  }`;
  let tab = 'items', lastTab = 'items', filter = 'all', msg = '', msgErr = false, openCard = null, guardState = null, lowState = null;

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v1.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 10.5z"/><path d="M5 13v7h14v-7"/><path d="M10 20v-4h4v4"/></svg>`;

  function build() {
    if (!document.body) return;
    if (!document.getElementById('tbm-css')) { const st = document.createElement('style'); st.id = 'tbm-css'; st.textContent = CSS; (document.head || document.body).appendChild(st); }
    if (!document.getElementById('tbm')) { const w = document.createElement('div'); w.id = 'tbm'; document.body.appendChild(w); }
    let b = document.getElementById('tbm-btn');
    const ref = document.getElementById('notes_panel_button');          // Torn's own chat-bar button
    if (ref && (!b || b.classList.contains('tbm-float') || !b.isConnected)) {
      if (b) b.remove();
      b = document.createElement('button');
      b.type = 'button'; b.id = 'tbm-btn'; b.title = 'Shopkeeper';
      b.className = ref.className;                                       // borrow Torn's style at runtime
      b.innerHTML = ICON + '<span class="tbm-badge"></span>';
      const svg = ref.querySelector('svg'); if (svg && svg.getAttribute('class')) b.querySelector('svg').setAttribute('class', svg.getAttribute('class'));
      ref.parentElement.insertBefore(b, ref);
      b.onclick = togglePanel;
      document.getElementById('tbm').classList.remove('tbm-floatpos');
    } else if (!ref && !b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'tbm-btn'; b.title = 'Shopkeeper';
      b.className = 'tbm-float'; b.innerHTML = ICON + '<span class="tbm-badge"></span>';
      document.body.appendChild(b); b.onclick = togglePanel;
      document.getElementById('tbm').classList.add('tbm-floatpos');
    }
    badge();
  }
  function togglePanel() {
    const w = document.getElementById('tbm'); const open = w.style.display !== 'flex';
    w.style.display = open ? 'flex' : 'none';
    if (open) { render(); if (key && Date.now() - lastRun > cfg.cacheMin * 60000) refresh(false, false); }
  }
  function openPanel() { const w = document.getElementById('tbm'); if (w && w.style.display !== 'flex') { w.style.display = 'flex'; } render(); }
  function setStatus(s) { msg = s; msgErr = false; const e = document.getElementById('tbm-msg'); if (e) { e.textContent = s; e.className = 'msg'; } }
  function toast(s, err) { msg = s; msgErr = !!err; const e = document.getElementById('tbm-msg'); if (e) { e.textContent = s; e.className = 'msg' + (err ? ' err' : ''); } }
  function badge() {
    const n = Object.values(items).filter(it => ['under', 'sold', 'shop'].includes(status(it).k)).length;
    const e = document.querySelector('#tbm-btn .tbm-badge'); if (e) { e.textContent = n; e.style.display = n ? 'block' : 'none'; }
  }
  function askKey() {
    const k = (prompt('Paste your own Torn API key – level LIMITED (needed to read your bazaar). It is stored only in your browser and only sent to api.torn.com:') || '').trim();
    if (!k) return;
    if (k.length !== 16) { alert('A Torn API key is 16 characters.'); return; }
    key = k; save('key', k); me = 0; save('me', 0); refresh(false, true);
  }

  function render() {
    const w = document.getElementById('tbm'); if (!w) return;
    badge();
    if (w.style.display !== 'flex') return;
    const all = Object.values(items);
    const value = all.reduce((s, t) => s + (t.bzQty || 0) * (t.bzPrice || 0), 0);
    const c = planCounts(), mode = pageMode(), simple = cfg.view !== 'advanced';
    const forSale = all.filter(t => t.bzQty > 0).length, empty = all.length - forSale;
    const bz = bazaar.open == null ? '' : bazaar.open ? '<span class="bz" style="background:#6aa84f">🟢 Open</span>' : '<span class="bz" style="background:#e06666">🔴 Closed</span>';
    const oldBody = w.querySelector('.body.main'), keep = oldBody ? { t: oldBody.scrollTop, l: oldBody.scrollLeft, tab: w.dataset.tab } : null;
    const stepName = { manage: 'prices & removals (Manage)', add: 'refill (Add items)', personalize: 'open/close (Personalize)' };
    const bzBtns = simple
      ? (bazaar.open === false ? '<button data-a="bzopen" title="Go to Personalize and choose Open – you press «change details»">🔓 Open bazaar</button>' : '<button data-a="bzclose" title="Go to Personalize and choose Closed – you press «change details»">🔒 Close bazaar</button>')
      : `<button data-a="bzopen" title="Go to Personalize and choose Open – you press «change details»">🔓 Open bazaar</button>
        <button data-a="bzclose" title="Go to Personalize and choose Closed – you press «change details»">🔒 Close bazaar</button>`;
    w.innerHTML = `
      <header>
        <span class="ttl">🏪 Shopkeeper</span><span class="ver">v${VERSION}</span>
        <span class="ad">· Like the script? Send a Xanax to <a href="https://www.torn.com/profiles.php?XID=4422625" target="_blank">Toppzy [4422625]</a></span>
        <span class="seg"><button data-a="view" data-v="simple" class="${simple ? 'on' : ''}" title="Only the main numbers">Simple</button><button data-a="view" data-v="advanced" class="${simple ? '' : 'on'}" title="All prices and details">Advanced</button></span>
        ${bz}
        <button data-a="refresh" class="rf" title="Refresh prices – reloads your bazaar, inventory and fresh Item Market + bazaar prices for every item in your bazaar list"><span class="rfi">⟳</span> ${ago(lastRun)}</button>
        <button data-a="settings" class="ico ${tab === 'set' ? 'on' : ''}" title="Settings">⚙</button><button data-a="key" class="ico" title="API key">🔑</button><button data-a="close" class="ico" title="Close">✕</button>
      </header>
      <div class="bar">
        <button data-a="apply" class="g" ${c.total ? '' : 'disabled'} title="Open the right bazaar page and fill in all your changes. You press Save / Add yourself.">▶ Apply${c.total ? ` (${c.total})` : ''}</button>
        <button data-a="fill" class="bl" title="${mode === 'add' ? 'Fill amounts and prices for all items on this page now' : 'Refill all items in your bazaar list (amount from Settings)'}">📦 Fill all${mode === 'add' ? ' now' : ''}</button>
        <button data-a="adjust" class="bl" title="${mode === 'manage' ? 'Fill suggested prices for all items on this page now' : 'Suggested price on all items (your own prices are kept)'}">💲 Adjust all prices${mode === 'manage' ? ' now' : ''}</button>
        <span class="sp"></span>
        ${bzBtns}
      </div>
      ${flow ? `<div class="flow">▶ Applying changes – step ${flow.i + 1} of ${flow.steps.length}: <b>${stepName[flow.steps[flow.i]]}</b>
        ${mode === flow.steps[flow.i] ? (pendingSave === mode ? `<button data-a="tornsave" class="g big" title="Presses Torn's own ${SAVE_BTN[mode].replace(/^\S+\s/, '')} button once">${SAVE_BTN[mode]}</button><span class="hint">(or ${SAVE_TXT[mode]})</span>` : `<span>– ${SAVE_TXT[flow.steps[flow.i]]}.</span>`) : `<button data-a="next" class="y">Go to step ${flow.i + 1}</button>`}
        <button data-a="cancelflow">Cancel</button></div>` : (pendingSave && pendingSave === mode ? `<div class="flow">Ready on this page: <button data-a="tornsave" class="g big" title="Presses Torn's own button once">${SAVE_BTN[mode]}</button><span class="hint">(or ${SAVE_TXT[mode]})</span></div>` : '')}
      ${lowState ? viewLow() : ''}
      ${guardState ? viewGuard() : ''}
      <div class="bar">
        <button data-tab="items" class="${tab === 'items' ? 'on' : ''}" title="The items in your bazaar list – also the ones at 0">🏪 Bazaar list (${all.length})</button>
        <button data-tab="inv" class="${tab === 'inv' ? 'on' : ''}" title="Add new items from your inventory to your bazaar list">➕ Add from inventory</button>
        ${tab === 'items' ? `<span class="sp hint">Show:</span>
          <button data-f="all" class="${filter === 'all' ? 'on' : ''}">All (${all.length})</button>
          <button data-f="sale" class="${filter === 'sale' ? 'on' : ''}">For sale (${forSale})</button>
          <button data-f="empty" class="${filter === 'empty' ? 'on' : ''}">Empty (${empty})</button>` : tab === 'set' ? '<span class="sp hint">⚙ Settings – press ⚙ again to go back</span>' : ''}
      </div>
      <div class="body main">${tab === 'items' ? viewItems() : tab === 'inv' ? viewInv() : viewSet()}</div>
      <div class="foot"><span>In bazaar: <b style="color:#fff">${fmt(value)}</b></span>
        ${c.total ? `<span>Pending: ${[c.price && c.price + ' price' + (c.price > 1 ? 's' : ''), c.qty && c.qty + ' refill' + (c.qty > 1 ? 's' : ''), c.rem && c.rem + ' removal' + (c.rem > 1 ? 's' : ''), c.bz && 'bazaar ' + planBazaar].filter(Boolean).join(' · ')} · <a data-a="clearplan">clear changes</a></span>` : ''}
        <span id="tbm-msg" class="msg${msgErr ? ' err' : ''}">${esc(msg)}</span></div>`;
    const nb = w.querySelector('.body.main');
    if (keep && keep.tab === tab && nb) { nb.scrollTop = keep.t; nb.scrollLeft = keep.l; }
    w.dataset.tab = tab;
    wire(w);
  }

  function wire(w) {
    w.querySelectorAll('[data-tab]').forEach(e => e.onclick = () => { tab = e.dataset.tab; lastTab = tab; render(); });
    w.querySelectorAll('[data-f]').forEach(e => e.onclick = () => { filter = e.dataset.f; render(); });
    w.querySelectorAll('[data-a]').forEach(e => { if (e.tagName !== 'SELECT') e.onclick = ev => { ev.preventDefault(); act(e.dataset.a, e); }; });
    w.querySelectorAll('input.cp').forEach(e => e.onchange = () => { const it = items[e.dataset.id]; if (!it) return; setPlanPrice(it, num(e.value), true); persist(); render(); });
    w.querySelectorAll('input.pq').forEach(e => e.onchange = () => { const it = items[e.dataset.id]; if (!it) return; const v = num(e.value); if (v > 0) P(it).qty = v; else delete P(it).qty; persist(); render(); });
    w.querySelectorAll('[data-set]').forEach(e => e.onchange = () => {
      const k = e.dataset.set;
      let v = e.type === 'checkbox' ? e.checked : e.value;
      if (typeof DEF[k] === 'number') v = num(v);
      cfg[k] = v;
      if (['priceSource', 'priceDelta', 'skipLowest', 'minPctOfMV'].includes(k)) cfg.preset = 'custom';
      if (k === 'safetyPct') cfg.safetyPct = Math.max(0, Math.min(100, cfg.safetyPct));
      save('cfg', cfg); savedTick(); render();
    });
    w.querySelectorAll('[data-card]').forEach(e => e.onchange = () => {
      const it = items[e.dataset.id]; if (!it) return;
      const k = e.dataset.card;
      if (k === 'strategy') {
        if (e.value === 'default') it.custom = null;
        else if (PRESETS[e.value]) it.custom = Object.assign({ name: e.value }, PRESETS[e.value]);
        else { const b = it.custom || strategyOf(null); it.custom = { name: 'custom', priceSource: b.priceSource, priceDelta: b.priceDelta, skipLowest: b.skipLowest, minPctOfMV: b.minPctOfMV }; }
      } else if (k === 'floor') { const v = e.value.trim(); it.floor = v === '' ? null : num(v); }
      else if (it.custom) { it.custom[k] = typeof DEF[k] === 'number' ? num(e.value) : e.value; }
      persist(); savedTick(); render();
    });
    const dl = w.querySelector('#tbm-delta'); if (dl) dl.onchange = () => {
      if (dl.value !== 'other') cfg.priceDelta = dl.value; else if (['-1', '-1%', '0'].includes(String(cfg.priceDelta))) cfg.priceDelta = '-2';
      save('cfg', cfg); savedTick(); render();
    };
    const gsel = w.querySelectorAll('select[id^="tbm-g-"]'); gsel.forEach(s => s.onchange = () => { guardState.choice[s.id.slice(6)] = s.value; });
    const nv = w.querySelector('#tbm-never'); if (nv) nv.onkeydown = ev => { if (ev.key === 'Enter') act('neveradd'); };
  }
  function savedTick() { msg = '✓ Saved'; msgErr = false; setTimeout(() => { if (msg === '✓ Saved') { msg = ''; const e = document.getElementById('tbm-msg'); if (e) e.textContent = ''; } }, 1500); }

  function viewItems() {
    if (!key) return '<p>Press 🔑 and paste a <b>Limited</b> API key to start.</p>';
    let list = Object.values(items);
    if (filter === 'sale') list = list.filter(t => t.bzQty > 0);
    if (filter === 'empty') list = list.filter(t => !t.bzQty);
    const order = { sold: 0, shop: 1, under: 2 };
    const ord = it => { const k = status(it).k; return k in order ? order[k] : 3; };
    list.sort((a, b) => ord(a) - ord(b) || (a.name || '').localeCompare(b.name || ''));
    if (!list.length) return '<p>No items here – press ⟳ to load your bazaar, or add items under ➕ Add from inventory.</p>';
    const simple = cfg.view !== 'advanced';
    const head = simple
      ? `<tr><th></th><th>Item</th><th class="n">In bazaar</th><th class="n">Inv</th><th class="n">Price</th><th>New price</th><th>Refill to</th><th class="stc">Status</th></tr>`
      : `<tr><th></th><th>Item</th><th class="n">In bazaar</th><th class="n opt">Inv</th><th class="n">Your price</th>
      <th class="n opt" title="Torn may cache Item Market prices for up to 1 hour">Lowest IM</th><th class="n opt">Lowest bazaar</th><th class="n opt">Avg bazaar</th><th class="n opt">Market</th>
      <th class="n">Suggested</th><th>Change price</th><th>Refill to</th><th>Status</th><th></th></tr>`;
    return `<table class="${simple ? 'simple' : 'adv'}">${head}` +
      list.map(it => {
        const p = prices[it.id] || {}, s = status(it), pl = it.plan || {}, sug = suggest(it, prices[it.id]);
        const fi = floorInfo(it), uniq = isUnique(it), low = lowPrice(it);
        const cls = pl.remove ? 'removing' : (pl.price || pl.qty) ? 'planned' : '';
        const gear = `<td><a class="gear ${it.custom || it.floor != null ? 'custom' : ''}" data-a="card" data-id="${it.id}" title="Settings for this item">⚙</a></td>`;
        const name = `<td><a href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${it.id}" target="_blank">${esc(it.name || it.id)}</a>${fi.v ? ` <span class="lock" title="Floor ${fmt(fi.v)} – ${fi.why}. Suggested prices never go below this.">🔒</span>` : ''}${!simple && it.custom ? ' <span class="hint" title="Own price strategy">★</span>' : ''}</td>`;
        const lowTxt = low ? `<div class="lowtxt">below floor ${fmt(fi.v)} (${fi.why})</div>` : '';
        const cpInput = `<input class="cp ${pl.price ? 'set' : ''} ${low ? 'low' : ''}" data-id="${it.id}" value="${pl.price ? pl.price.toLocaleString('en-US') : ''}" placeholder="new price">${pl.price ? ` <button class="mini" data-a="undo" data-id="${it.id}" title="Undo">↺</button>` : ''}`;
        // Refill to N = N in the bazaar in total
        const add = addOf(it), hasQ = pl.qty > 0;
        const refill = (it.inv > 0 || hasQ)
          ? `<input class="pq" data-id="${it.id}" value="${hasQ ? pl.qty : ''}" placeholder="${it.bzQty || 0}" title="How many you want in your bazaar in total" style="${hasQ ? 'border-color:#6aa84f;color:#b6d7a8' : ''}"> <button class="max" data-a="max" data-id="${it.id}" title="All you have: ${(it.bzQty || 0) + (it.inv || 0)} in total">Max</button>${hasQ ? `<span class="add">+${add}</span>` : ''}${s.k === 'shop' ? '<div class="hint">shop pays more</div>' : ''}`
          : `<span class="hint">${s.k === 'shop' ? 'shop pays more' : 'none in inv'}</span>`;
        const st = `<span class="st" style="background:${pl.remove ? '#e06666' : s.col}" title="${esc(pl.remove ? 'Removing' : s.txt)}">${pl.remove ? 'Removing' : esc(s.txt)}</span>`;
        if (simple) {
          const showSug = !pl.price && !uniq && s.k !== 'shop' && sug && sug !== (it.bzQty ? it.bzPrice : 0);
          return `<tr class="${cls}">${gear}${name}
          <td class="n">${it.bzQty || 0}</td><td class="n">${it.inv || 0}</td>
          <td class="n">${it.bzQty ? fmt(it.bzPrice) : '–'}</td>
          <td>${cpInput}${showSug ? ` <button class="sug" data-a="usesug" data-id="${it.id}" title="Use the suggested price">⇐ ${fmt(sug)}</button>` : ''}${uniq && !pl.price ? ' <span class="hint" title="Weapons/armor: quality and bonuses vary – set the price yourself">manual</span>' : ''}${lowTxt}</td>
          <td>${refill}</td><td>${st}</td></tr>` + (openCard === it.id ? viewCard(it) : '');
        }
        return `<tr class="${cls}">${gear}${name}
          <td class="n">${it.bzQty || 0}</td><td class="n opt">${it.inv || 0}</td>
          <td class="n">${it.bzQty ? fmt(it.bzPrice) : '–'}</td>
          <td class="n opt" title="Checked ${ago(p.t)} (Torn may cache up to 1 h)">${fmt(nth(p.imList, 0))}${p.t ? `<div class="hint">${ago(p.t)}</div>` : ''}</td>
          <td class="n opt">${p.t && cfg.useWeav3r && p.bzOk === false ? '<span class="hint" title="weav3r.dev did not answer – Item Market only">n/a</span>' : fmt(nth(p.bzList, 0))}</td>
          <td class="n opt">${fmt(p.bzAvg)}</td><td class="n opt">${fmt(mvOf(it))}</td>
          <td class="n">${uniq ? '<span class="hint" title="Weapons/armor: quality and bonuses vary – set the price yourself">manual</span>' : `<b style="color:#fff">${fmt(sug)}</b>${sug ? ` <button class="mini" data-a="usesug" data-id="${it.id}" title="Copy suggested into Change price">⇐</button>` : ''}`}</td>
          <td>${cpInput}${pl.price ? `<div class="hint">${it.bzQty ? `${fmt(it.bzPrice)} → ${fmt(pl.price)}` : `new: ${fmt(pl.price)}${add ? ' × ' + add : ''}`}${pl.locked ? '' : ' (auto)'}</div>` : ''}${lowTxt}</td>
          <td>${refill}</td>
          <td>${st}</td>
          <td><a data-a="remove" data-id="${it.id}" title="Remove from bazaar and list">✕</a></td></tr>` +
          (openCard === it.id ? viewCard(it) : '');
      }).join('') + '</table>';
  }

  function viewCard(it) {
    const s = it.custom, cur = s ? (s.name || 'custom') : 'default', auto = abroad[it.id];
    const opt = (v, l) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
    const fa = floorInfo(Object.assign({}, it, { floor: null }));
    return `<tr class="card"><td colspan="20">
      <div class="grid">
        <div><label>Price strategy for ${esc(it.name)}</label><select data-card="strategy" data-id="${it.id}">
          ${opt('default', 'Use default (Settings)')}${opt('fast', '🏃 Sell fast')}${opt('balanced', '⚖️ Balanced')}${opt('profit', '💰 Max profit')}${opt('custom', '✏️ Custom')}</select></div>
        ${cur === 'custom' ? `
          <div><label>Beat</label><select data-card="priceSource" data-id="${it.id}">${Object.keys(SRC).map(k => `<option value="${k}" ${s.priceSource === k ? 'selected' : ''}>${SRC[k]}</option>`).join('')}</select></div>
          <div><label>Change ($ or %)</label><input data-card="priceDelta" data-id="${it.id}" value="${esc(s.priceDelta)}" style="width:60px"></div>
          <div><label>Ignore cheapest</label><input data-card="skipLowest" data-id="${it.id}" value="${s.skipLowest}" style="width:40px"></div>
          <div><label>Never below % of market</label><input data-card="minPctOfMV" data-id="${it.id}" value="${s.minPctOfMV}" style="width:45px"></div>` : ''}
        <div><label>Floor – never sell below <span class="info" title="Empty = automatic: the highest of ${+cfg.safetyPct || 0} % of market value, the shop price and the price you paid abroad. 0 = no floor.">ⓘ</span></label>
          <input data-card="floor" data-id="${it.id}" value="${it.floor != null ? it.floor : ''}" placeholder="${fa.v ? 'auto ' + fmt(fa.v) : 'none'}" style="width:100px"></div>
        <div><button data-a="resetitem" data-id="${it.id}">↺ Reset to default</button></div>
        <div><button data-a="remove" data-id="${it.id}" class="r" title="Remove from bazaar and list">✕ Remove item</button></div>
      </div>
      <div class="hint" style="margin-top:6px">Settings here apply only to ${esc(it.name)} and stay locked even if you change the main Settings.
        Automatic floor: ${fa.v ? `${fmt(fa.v)} (${fa.why})` : 'none'}${shopOf(it) ? ` · shop pays ${fmt(shopOf(it))}` : ''}${mvOf(it) ? ` · market ${fmt(mvOf(it))}` : ''}${auto ? ` · seen abroad for ${fmt(auto.cost)} (${ago(auto.t)})` : ''}.</div>
    </td></tr>`;
  }

  function viewLow() {
    const g = lowState;
    return `<div class="body" style="flex:none;max-height:40vh;border-bottom:1px solid #990000;background:#2a1515">
      <b style="color:#ea9999">⚠ ${g.items.length} price${g.items.length > 1 ? 's are' : ' is'} below the floor</b>
      <table class="modal"><tr><th>Item</th><th class="n">Your price</th><th class="n">Floor</th><th>Why</th><th class="n">Market</th></tr>
      ${g.items.map(it => { const f = floorInfo(it); return `<tr><td>${esc(it.name)}</td><td class="n"><b style="color:#ea9999">${fmt(it.plan.price)}</b></td><td class="n">${fmt(f.v)}</td><td>${esc(f.why)}</td><td class="n">${fmt(mvOf(it))}</td></tr>`; }).join('')}
      </table>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button data-a="lowfix" class="y">Use the floor price</button><button data-a="lowgo" class="r">Apply my prices anyway</button><button data-a="lowcancel">Cancel</button></div></div>`;
  }

  function viewGuard() {
    const g = guardState;
    return `<div class="body" style="flex:none;max-height:40vh;border-bottom:1px solid #7f6000;background:#2a2400">
      <b style="color:#ffe599">⚠ The market has moved since you set these prices</b>
      <table class="modal"><tr><th>Item</th><th class="n">Your price</th><th class="n">Cheapest then</th><th class="n">Cheapest now</th><th class="n">New suggestion</th><th>Use</th></tr>
      ${g.items.map(it => { const p = prices[it.id], now = lowestOther(p), sug = suggest(it, p); return `<tr><td>${esc(it.name)}</td><td class="n">${fmt(it.plan.price)}</td><td class="n">${fmt(it.plan.priceRef)}</td><td class="n">${fmt(now)}</td><td class="n"><b>${fmt(sug)}</b></td>
        <td><select id="tbm-g-${it.id}"><option value="keep">My price</option><option value="new" ${g.choice[it.id] === 'new' ? 'selected' : ''}>New suggestion</option></select></td></tr>`; }).join('')}
      </table>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button data-a="guardnew" class="y">Use new prices for all</button><button data-a="guardgo" class="g">Continue with my choices</button><button data-a="guardcancel">Cancel</button></div></div>`;
  }
  function showGuard(moved, steps) { guardState = { items: moved, steps, choice: {} }; openPanel(); }
  function guardFinish(allNew) {
    for (const it of guardState.items) {
      if (allNew || guardState.choice[it.id] === 'new') { const v = suggest(it, prices[it.id]); if (v) setPlanPrice(it, v, it.plan.locked); }
      else it.plan.priceRef = lowestOther(prices[it.id]);
    }
    const steps = guardState.steps; guardState = null; persist(); startFlow(steps);
  }

  const PLURAL = { Plushie: 'Plushies', Flower: 'Flowers', Drug: 'Drugs', Material: 'Materials', 'Supply Pack': 'Supply Packs', Collectible: 'Collectibles', Enhancer: 'Enhancers', Tool: 'Tools', Booster: 'Boosters', Book: 'Books', Artifact: 'Artifacts', Car: 'Cars', 'Energy Drink': 'Energy Drinks', Defensive: 'Armor', Other: 'Other' };
  const catName = t => PLURAL[t] || t;
  let invCat = load('invCat', 'all'), invSort = load('invSort', { k: 'name', d: 1 });
  function invVisible() {
    let list = Object.values(invAll || {}).filter(i => i.amount > 0);
    if (invCat !== 'all') list = list.filter(i => i.type === invCat);
    const val = i => i.amount * ((invValues[i.id] && invValues[i.id].mp) || 0);
    const k = invSort.k, d = invSort.d;
    list.sort((a, b) => (k === 'amount' ? a.amount - b.amount : k === 'value' ? val(a) - val(b) : a.name.localeCompare(b.name)) * d || a.name.localeCompare(b.name));
    return list;
  }
  function viewInv() {
    if (!invAll) return '<p>Scan your whole inventory to find items you can add to your bazaar list (about 25 API calls).</p><button class="g" data-a="scan">Scan now</button>';
    const all = Object.values(invAll).filter(i => i.amount > 0);
    const cats = {}; all.forEach(i => cats[i.type] = (cats[i.type] || 0) + 1);
    if (invCat !== 'all' && !cats[invCat]) invCat = 'all';
    const list = invVisible();
    const arrow = k => invSort.k === k ? (invSort.d > 0 ? ' ▲' : ' ▼') : '';
    const val = i => i.amount * ((invValues[i.id] && invValues[i.id].mp) || 0);
    return `<div class="bar" style="padding:0 0 6px;border:0"><button class="g" data-a="scan">Scan now</button>
        <button data-a="trackall">+ Add all${invCat !== 'all' ? ' ' + esc(catName(invCat)) : ''} to bazaar list (except Never sell)</button>
        <span class="hint">Only items you own. Equipped and faction items are hidden.</span></div>
      <div class="bar" style="padding:0 0 6px;border:0">
        <button data-a="invcat" data-c="all" class="${invCat === 'all' ? 'on' : ''}">All (${all.length})</button>
        ${Object.keys(cats).sort((a, b) => catName(a).localeCompare(catName(b))).map(c => `<button data-a="invcat" data-c="${esc(c)}" class="${invCat === c ? 'on' : ''}">${esc(catName(c))} (${cats[c]})</button>`).join('')}
      </div>
      <table><tr><th><a data-a="invsort" data-k="name">Item${arrow('name')}</a></th><th class="opt">Category</th><th class="n"><a data-a="invsort" data-k="amount">Amount${arrow('amount')}</a></th><th class="n"><a data-a="invsort" data-k="value" title="Amount × market price">Value${arrow('value')}</a></th><th></th></tr>` +
      list.map(i => `<tr><td>${esc(i.name)}${isNever(i.name) ? ' <span class="hint">(never sell)</span>' : ''}</td><td class="opt">${esc(catName(i.type))}</td><td class="n">${i.amount}</td><td class="n">${fmt(val(i))}</td>
        <td>${items[i.id] ? '<span style="color:#6aa84f">In bazaar list</span>' : `<button data-a="track" data-id="${i.id}">+ Add</button>`}</td></tr>`).join('') + '</table>';
  }
  // market value + shop sell price – one bulk call per 100 items (torn/{ids}/items)
  let invValues = load('invValues', {});
  async function fetchInvValues(ids) {
    const need = ids.filter(id => !invValues[id] || invValues[id].sell == null || Date.now() - invValues[id].t > cfg.cacheMin * 60000);
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      try {
        const j = await torn(`torn/${chunk.join(',')}/items`, 'Market values');
        for (const it of j.items || []) { const v = it.value || {}; invValues[String(it.id)] = { mp: +(v.market_price != null ? v.market_price : it.market_value) || 0, sell: +(v.sell_price != null ? v.sell_price : it.sell_price) || 0, t: Date.now() }; }
      } catch (e) { if ([2, 7, 16].includes(e.code)) throw e; }
    }
    save('invValues', invValues);
  }

  function exampleLine() {
    const it = Object.values(items).find(t => prices[t.id] && lowestOther(prices[t.id]) && !isUnique(t));
    if (!it) return 'An example appears here after the first price refresh.';
    const p = prices[it.id];
    const base = basePrice(p, cfg);
    const what = cfg.priceSource === 'market' ? 'normal market price' : cfg.priceSource === 'avgBazaar' ? 'average bazaar price' : 'price to beat';
    return `Example – <b>${esc(it.name)}</b>: ${what} ${fmt(base)} → your price <b style="color:#fff">${fmt(suggest(Object.assign({}, it, { custom: null }), p))}</b>`;
  }

  function viewSet() {
    const pre = (k, ico, label, sub) => `<button data-a="preset" data-p="${k}" class="${cfg.preset === k ? 'on' : ''}" title="${sub}">${ico} ${label}${k === 'balanced' ? ' (recommended)' : ''}</button>`;
    const o = (k, v, l) => `<option value="${v}" ${String(cfg[k]) === String(v) ? 'selected' : ''}>${l}</option>`;
    const deltaChoice = ['-1', '-1%', '0'].includes(String(cfg.priceDelta)) ? String(cfg.priceDelta) : 'other';
    const customCount = Object.values(items).filter(t => t.custom || t.floor != null).length;
    const sp = +cfg.safetyPct || 0;
    const desc = { fast: `$1 under the cheapest seller. Never below 70 % of the market price${sp > 70 ? ` (your safety floor of ${sp} % wins)` : ''}.`, balanced: `$1 under the cheapest seller, but ignores the single cheapest listing and never goes below 90 % of the market price${sp > 90 ? ` (your safety floor of ${sp} % wins)` : ''}.`, profit: 'Market price − $1. Highest price, sells slower.', custom: 'You choose everything below.' };
    return `<div class="set">
      <h4>💲 How should prices be set?</h4>
      <div class="presets">
        ${pre('fast', '🏃', 'Sell fast', desc.fast)}${pre('balanced', '⚖️', 'Balanced', desc.balanced)}${pre('profit', '💰', 'Max profit', desc.profit)}${pre('custom', '✏️', 'Custom', desc.custom)}
      </div>
      <div class="hint" style="margin-top:4px">${desc[cfg.preset] || ''}</div>
      <div class="example">${exampleLine()}</div>
      <div class="q"><div>🔒 Safety floor <span class="info" title="Applies to every item automatically. The floor is the highest of: this % of the market value, what Torn's shops pay for the item, and what you paid abroad. Suggested prices never go below it, and ▶ Apply warns you if your own price is below it. Set a floor per item with ⚙ (0 = no floor).">ⓘ</span></div>
        Never sell below <input data-set="safetyPct" value="${cfg.safetyPct}" style="width:50px"> % of the market value <span class="hint">– and never below what a shop pays (then the item shows «Sell to shop»). 0 = off.</span></div>
      ${cfg.preset === 'custom' ? `
      <div class="q"><div>Who do you want to beat? <span class="info" title="The price your suggestion is based on.">ⓘ</span></div>
        <select data-set="priceSource">${Object.keys(SRC).map(k => o('priceSource', k, SRC[k])).join('')}</select></div>
      <div class="q"><div>How much cheaper? <span class="info" title="-1 = one dollar cheaper. -1% = one percent cheaper. 0 = same price.">ⓘ</span></div>
        <select id="tbm-delta">${['-1', '-1%', '0', 'other'].map(v => `<option value="${v}" ${deltaChoice === v ? 'selected' : ''}>${{ '-1': '$1 cheaper', '-1%': '1 % cheaper', '0': 'Same price', other: 'Other…' }[v]}</option>`).join('')}</select>
        ${deltaChoice === 'other' ? `<input data-set="priceDelta" value="${esc(cfg.priceDelta)}" style="width:70px"> <span class="hint">e.g. -100, -2%, +5%</span>` : ''}</div>
      <div class="q"><div>Ignore suspiciously cheap listings? <span class="info" title="Someone selling 1 item far below everyone else can drag your price down. Ignoring the cheapest 1–2 listings protects you.">ⓘ</span></div>
        <select data-set="skipLowest">${o('skipLowest', 0, 'No')}${o('skipLowest', 1, 'Ignore the cheapest one')}${o('skipLowest', 2, 'Ignore the two cheapest')}</select></div>
      <div class="q"><div>Lowest price you accept <span class="info" title="Market price = Torn's normal price for the item. 0 = no limit.">ⓘ</span></div>
        Never below <input data-set="minPctOfMV" value="${cfg.minPctOfMV}" style="width:50px"> % of the market price</div>` : ''}

      <h4>📦 Fill all <span class="info" title="Fill all uses the items in your bazaar list. Add items under «➕ Add from inventory». Items where a shop pays more are skipped.">ⓘ</span></h4>
      <div class="q"><div>How many of each? <span class="info" title="A «Refill to» amount you set on an item always wins over this.">ⓘ</span></div><select data-set="qtyMode">${o('qtyMode', 'all', 'Everything in inventory')}${o('qtyMode', 'minus1', 'Fill all −1 (keep 1)')}${o('qtyMode', 'leave', 'All but N (keep N)')}${o('qtyMode', 'pct', 'Percentage')}</select>
        ${cfg.qtyMode === 'leave' ? ` keep <input data-set="leaveQty" value="${cfg.leaveQty}" style="width:45px"> in my inventory` : ''}
        ${cfg.qtyMode === 'pct' ? ` <input data-set="pctQty" value="${cfg.pctQty}" style="width:45px"> % of what I have` : ''}</div>
      <div class="q"><div>Never sell <span class="info" title="Items here are never added to your bazaar by the script.">ⓘ</span></div>
        ${cfg.neverSell.map((n, i) => `<span class="chip">${esc(n)}<a data-a="neverdel" data-i="${i}">✕</a></span>`).join('') || '<span class="hint">Nothing yet.</span>'}
        <div style="margin-top:4px"><input id="tbm-never" placeholder="Item name, e.g. Xanax" style="width:180px"> <button data-a="neveradd">+ Add</button></div></div>

      <h4>💲 Adjust all prices</h4>
      <div class="q"><div>Which items?</div><select data-set="manageMode">${o('manageMode', 'all', 'All items')}${o('manageMode', 'undercut', 'Only items where I am undercut')}</select></div>

      <details><summary>Advanced</summary>
        <div class="q"><div>Check my bazaar in the background every</div><select data-set="autoCheckMin">${o('autoCheckMin', 0, 'Off')}${o('autoCheckMin', 5, '5 minutes')}${o('autoCheckMin', 15, '15 minutes')}${o('autoCheckMin', 30, '30 minutes')}</select> <span class="hint">updates «Sold out» and the red number (about 3–10 API calls)</span></div>
        <div class="q"><div>Reuse prices for</div><input data-set="cacheMin" value="${cfg.cacheMin}" style="width:50px"> minutes</div>
        <div class="q"><div>Warn before Apply if the market moved more than</div><input data-set="guardPct" value="${cfg.guardPct}" style="width:50px"> %</div>
        <div class="q"><div>Max Torn API calls per minute</div><input data-set="tornPerMin" value="${cfg.tornPerMin}" style="width:50px"> <span class="hint">Torn allows 100 per minute for your whole account</span></div>
        <div class="q"><label style="color:#ccc"><input type="checkbox" data-set="useWeav3r" ${cfg.useWeav3r ? 'checked' : ''}> Use bazaar prices from weav3r.dev</label> <span class="hint">free service, your key is never sent there</span></div>
      </details>

      <div class="danger"><h4>Danger zone</h4>
        <button data-a="resetall" class="r">Reset all items to default (${customCount})</button>
        <button data-a="clearlist" class="r">Clear item list</button>
        <div class="hint" style="margin-top:4px">The script only fills fields. You always press Save changes / Add to bazaar / change details yourself.</div></div>
    </div>`;
  }

  function act(a, el) {
    const id = el && el.dataset ? el.dataset.id : null;
    switch (a) {
      case 'close': document.getElementById('tbm').style.display = 'none'; return;
      case 'refresh': return refresh(false, true);
      case 'scan': return refresh(true, false);
      case 'key': return askKey();
      case 'view': cfg.view = el.dataset.v; save('cfg', cfg); openCard = null; return render();
      case 'settings': if (tab === 'set') tab = lastTab || 'items'; else { lastTab = tab; tab = 'set'; } return render();
      case 'apply': return actApply(false);
      case 'max': { const it = items[id]; const n = (it.bzQty || 0) + (it.inv || 0); if (n > 0) P(it).qty = n; persist(); return render(); }
      case 'lowfix': { for (const it of lowState.items) { const f = floorOf(it); if (f) setPlanPrice(it, f, true); } lowState = null; persist(); render(); return actApply(true); }
      case 'lowgo': lowState = null; render(); return actApply(true);
      case 'lowcancel': lowState = null; return render();
      case 'fill': return actFill();
      case 'adjust': return actAdjust();
      case 'bzopen': return actBazaar('open');
      case 'bzclose': return actBazaar('close');
      case 'next': return nextStep();
      case 'tornsave': return pressTorn();
      case 'cancelflow': return cancelFlow();
      case 'clearplan': if (confirm('Clear all pending changes?')) { for (const it of Object.values(items)) it.plan = {}; planBazaar = null; persist(); render(); } return;
      case 'card': openCard = openCard === id ? null : id; return render();
      case 'usesug': { const it = items[id]; setPlanPrice(it, suggest(it, prices[id]), true); persist(); return render(); }
      case 'undo': { const it = items[id]; setPlanPrice(it, 0); persist(); return render(); }
      case 'remove': return actRemove(id);
      case 'resetitem': { const it = items[id]; if (confirm(`Reset ${it.name} to default settings?`)) { it.custom = null; it.floor = null; persist(); render(); } return; }
      case 'resetall': { const n = Object.values(items).filter(t => t.custom || t.floor != null).length; if (!n) return toast('No items have their own settings.'); if (confirm(`Reset ${n} items with custom settings to default?`)) { for (const t of Object.values(items)) { t.custom = null; t.floor = null; } persist(); render(); } return; }
      case 'clearlist': if (confirm('Clear the whole item list? (Your bazaar in Torn is not changed.)')) { items = {}; prices = {}; persist(); render(); } return;
      case 'preset': { const p = el.dataset.p; cfg.preset = p; if (PRESETS[p]) Object.assign(cfg, PRESETS[p]); save('cfg', cfg); savedTick(); return render(); }
      case 'neveradd': { const inp = document.getElementById('tbm-never'); const v = (inp && inp.value || '').trim(); if (v && !isNever(v)) { cfg.neverSell.push(v); save('cfg', cfg); savedTick(); render(); } return; }
      case 'neverdel': cfg.neverSell.splice(+el.dataset.i, 1); save('cfg', cfg); savedTick(); return render();
      case 'track': case 'trackall': {
        const list = a === 'track' ? [invAll[id]] : invVisible().filter(i => !isNever(i.name) && !items[i.id]);
        for (const i of list) items[i.id] = { id: i.id, name: i.name, type: i.type, bzQty: 0, bzPrice: 0, inv: i.amount, floor: null, custom: null, plan: {} };
        persist(); render();
        if (list.length) toast(`${list.length} item${list.length > 1 ? 's' : ''} added to your bazaar list.`);
        guard(async () => { await fetchInvValues(list.map(i => i.id)); let n = 0; for (const i of list) { n++; setStatus(`Prices ${n}/${list.length} …`); await fetchPrice(i.id); } setStatus(''); });
        return;
      }
      case 'invcat': invCat = el.dataset.c; save('invCat', invCat); return render();
      case 'invsort': { const k = el.dataset.k; invSort = invSort.k === k ? { k, d: -invSort.d } : { k, d: k === 'name' ? 1 : -1 }; save('invSort', invSort); return render(); }
      case 'guardnew': return guardFinish(true);
      case 'guardgo': return guardFinish(false);
      case 'guardcancel': guardState = null; return render();
    }
  }

  /* =====================================================================
   *  START
   * ===================================================================*/
  build();
  let lastHref = location.href;
  setInterval(() => {
    build();
    if (location.href !== lastHref) { lastHref = location.href; pendingSave = null; render(); if (flow) runFlowStep(); watchManage(); }
  }, 1500);
  setInterval(autoCheck, 60000);
  setTimeout(autoCheck, 5000);
  setTimeout(() => { if (flow) runFlowStep(); captureAbroad(); watchManage(); }, 1500);
  setInterval(captureAbroad, 10000);
})();
