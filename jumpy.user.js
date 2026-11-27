// ==UserScript==
// @name         Jumpy – Torn happy-jump helper
// @namespace    jumpy.torn
// @version      0.1.5
// @description  Jumpy guides you through a happy jump (Console, Candy or eDVD): plan, happy target before Ecstasy, quarter-hour tick warning, drug/booster cooldowns, next-jump countdown, items needed and the gain after. Item buttons use one item per click (the same request as Torn's own Okay button, like TornTools Quick items) – nothing happens by itself.
// @author       Toppzy [4422625]
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/skur-commits/torn-scripts/main/jumpy.user.js
// @downloadURL  https://raw.githubusercontent.com/skur-commits/torn-scripts/main/jumpy.user.js
// @homepageURL  https://github.com/skur-commits/torn-scripts
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  const VERSION = '0.1.5';

  /* =====================================================================
   *  STORAGE
   * ===================================================================*/
  const hasGM = typeof GM_getValue === 'function';
  const load = (k, d) => { try { const v = hasGM ? GM_getValue(k) : localStorage.getItem('jpy_' + k); return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return d; } };
  const save = (k, v) => { try { hasGM ? GM_setValue(k, JSON.stringify(v)) : localStorage.setItem('jpy_' + k, JSON.stringify(v)); } catch (e) { } };

  const DEF = { jump: 'console', xan: 3, candy: 48, edvd: 5, ctype: 'kiss', refill: true, fin: false,
    co: 'none', stars: 1, coAuto: true, jp: 0, spec: 'auto', vor: 0, book: false, wdd: false,
    lastStat: '' };                 // lastStat: the stat you trained most in your last jump (tie-break)
  let cfg = Object.assign({}, DEF, load('cfg', {}));
  const saveCfg = () => save('cfg', cfg);

  // TornPDA: detected automatically; PDA replaces the placeholder with the user's own key
  const IS_PDA = typeof window.flutter_inappwebview !== 'undefined' || typeof window.PDA_httpGet === 'function';
  const PDA_KEY = '###PDA-APIKEY###';
  const pdaKey = () => (IS_PDA && /^[A-Za-z0-9]{16}$/.test(PDA_KEY)) ? PDA_KEY : '';
  let key = load('key', '') || pdaKey();

  // D = last data from the API (t = when it was read); J = the jump in progress
  let D = load('data', null);
  let J = load('jump', { phase: 'idle' });
  let ui = load('ui', { open: false, min: false });
  const saveJ = () => save('jump', J), saveUi = () => save('ui', ui);
  let setOpen = false, tosOpen = false, missWarned = false, msg = '', msgErr = false, busy = false;

  /* =====================================================================
   *  GAME DATA
   * ===================================================================*/
  const CAP = 1000;                 // energy from Xanax stacks to 1,000 at most
  const HMAX = 99999;               // Torn's hard happy cap
  // One job at a time: company + stars decide which specials (job points) and passive perks help a jump.
  // Sources: Torn Wiki Company/Special List, TornStats companies. «tn» = Torn's company type name (for the API).
  const COS = {
    none: { n: 'No job / none of these', sp: [], pv: [] },
    toy: { n: 'Toy Shop', sp: [{ n: 'Memory Lane', s: 1, h: 50, c: 1 }], pv: [{ s: 5, k: 'gamer', t: 'Gamer: console happy ×2' }] },
    game: { n: 'Game Shop', sp: [{ n: 'Overpowered', s: 10, h: 50, c: 1 }], pv: [{ s: 5, k: 'gamer', t: 'Gamer: console happy ×2' }] },
    adult: { n: 'Adult Novelties', sp: [], pv: [{ s: 10, k: 'indecent', t: 'Indecent: eDVD happy ×2 (5,000 each)' }] },
    sweet: { n: 'Sweet Shop', sp: [{ n: 'Voracious', s: 10, h: 4500, c: 30 }, { n: 'Gluttony', s: 5, h: 1000, c: 10 }, { n: 'Sweet Tooth', s: 1, h: 50, c: 1 }], pv: [] },
    candle: { n: 'Candle Shop', sp: [{ n: 'Warming Therapy', s: 1, h: 50, c: 1 }], pv: [] },
    music: { n: 'Music Store', sp: [{ n: 'Ambience', s: 1, h: 50, c: 1 }], pv: [] },
    farm: { n: 'Farm', sp: [{ n: 'Fulfillment', s: 1, h: 50, c: 1 }], pv: [] },
    prop: { n: 'Property Broker', sp: [{ n: 'Job Satisfaction', s: 3, h: 50, c: 1 }], pv: [] },
    fit: { n: 'Fitness Center', sp: [], pv: [{ s: 3, k: 'goal', t: 'Goal Oriented: 50 % less happy lost in the gym' }, { s: 10, k: 'regime', t: 'Training Regime: +3 % gym gains' }] },
    groc: { n: 'Grocery Store', sp: [], pv: [{ s: 3, k: 'cd10', t: 'Fast Metabolism: −10 % booster cooldown (more candy/eDVD)' }, { s: 7, k: 'absorb', t: 'Absorption: +10 % happy from candy' }] },
    rest: { n: 'Restaurant', sp: [], pv: [{ s: 10, k: 'cd25', t: 'Professional Metabolism: −25 % booster cooldown (more candy/eDVD)' }] }
  };
  // candy: [name, happy] – Torn Wiki; one exact item per choice
  const CANDY = { kiss: ['Bag of Chocolate Kisses', 25], bbag: ['Bag of Bon Bons', 25], bbox: ['Box of Bon Bons', 25], loli: ['Lollipop', 25],
    ck: ['Bag of Candy Kisses', 50], tr: ['Bag of Tootsie Rolls', 75], tf: ['Bag of Chocolate Truffles', 100],
    px: ['Pixie Sticks', 150], jb: ['Jawbreaker', 150], sh: ['Bag of Sherbet', 150] };
  const STATS = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };

  const co = () => COS[cfg.co] || COS.none;
  const specials = () => co().sp.filter(x => cfg.stars >= x.s).sort((a, b) => b.h / b.c - a.h / a.c);
  const has = k => co().pv.some(p => p.k === k && cfg.stars >= p.s);
  const hasGamer = () => has('gamer'), hasGoal = () => has('goal');
  const boostF = () => has('cd25') ? 0.75 : has('cd10') ? 0.9 : 1;          // booster cooldown factor
  const candyMult = () => (1 + (cfg.vor || 0) / 100 + (has('absorb') ? 0.1 : 0)) * (cfg.book ? 2 : 1) * (cfg.wdd ? 3 : 1);
  const CN = () => (CANDY[cfg.ctype] || CANDY.kiss)[0];
  const candyH = () => Math.round((CANDY[cfg.ctype] || CANDY.kiss)[1] * candyMult()), dvdH = () => has('indecent') ? 5000 : 2500;
  const maxCandy = () => Math.floor(1440 / (30 * boostF())) + 1, maxDvd = () => Math.floor(1440 / (360 * boostF())) + 1;   // one item may take you over 24h
  function jobPlan() { let jp = cfg.jp, h = 0; const used = []; for (const x of specials().filter(x => cfg.spec === 'auto' || x.n === cfg.spec)) { const k = Math.floor(jp / x.c); if (k) { h += k * x.h; jp -= k * x.c; used.push(`${k}× ${x.n}`); } } return { h, used }; }

  /* =====================================================================
   *  HELPERS
   * ===================================================================*/
  const fmt = n => Math.round(n || 0).toLocaleString('en-US');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toTick = () => { const d = new Date(); return (15 - d.getUTCMinutes() % 15) * 60 - d.getUTCSeconds(); };   // happy above max drops at xx:00/15/30/45 TCT
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const hm = sec => sec <= 0 ? 'ready' : `${Math.floor(sec / 3600)}h ${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}m`;
  const age = () => D ? Math.floor((Date.now() - D.t) / 1000) : 0;
  const cdNow = k => D ? Math.max(0, (D[k] || 0) - age()) : 0;            // cooldowns count down between API reads
  const page = () => location.pathname.replace(/^\//, '');
  const onGym = () => /^gym\.php/.test(page());
  const onItems = () => /^item\.php/.test(page());
  const URLS = { items: 'https://www.torn.com/item.php', gym: 'https://www.torn.com/gym.php', points: 'https://www.torn.com/page.php?sid=points', job: 'https://www.torn.com/companies.php' };

  /* =====================================================================
   *  API (Limited key) – one user call + inventory (Torn caches inventory 15 min per category)
   * ===================================================================*/
  const ERR = { 1: 'the key is empty', 2: 'the API key is wrong', 5: 'too many API calls – wait a minute', 7: 'your key level is too low (use a Limited key)',
    8: 'your IP is temporarily blocked by Torn', 9: 'the Torn API is down', 13: 'the key is paused', 16: 'your key level is too low (use a Limited key)', 17: 'Torn backend error – try again' };
  async function api(url) {
    let j;
    try { j = await (await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + key + '&comment=Jumpy')).json(); }
    catch (e) { throw new Error('could not reach the Torn API'); }
    if (j && j.error) { const e = new Error(ERR[j.error.code] || j.error.error || 'API error'); e.code = j.error.code; throw e; }
    return j;
  }
  const val = v => v == null ? 0 : typeof v === 'object' ? +(v.value ?? v.current ?? 0) : +v;
  async function refresh(withInv) {
    if (!key || busy) return;
    busy = true;
    try {
      const u = await api('https://api.torn.com/user/?selections=bars,cooldowns,battlestats,profile,money,gym,jobpoints');
      const prev = D || {};
      D = Object.assign({}, prev, {
        t: Date.now(),
        e: val(u.energy && u.energy.current), emax: val(u.energy && u.energy.maximum) || 150,
        happy: val(u.happy && u.happy.current), hmax: val(u.happy && u.happy.maximum) || 0,
        drug: val(u.cooldowns && u.cooldowns.drug), booster: val(u.cooldowns && u.cooldowns.booster),
        stats: { strength: val(u.strength), defense: val(u.defense), speed: val(u.speed), dexterity: val(u.dexterity) },
        jpApi: jobPointsOf(u), points: val(u.points), gym: +u.active_gym || 0, coId: (u.job && u.job.company_id) || 0, coType: (u.job && u.job.company_type) || 0
      });
      await jobFromApi(); await fetchGyms();
      if (D.jpApi != null && cfg.jp !== D.jpApi) { cfg.jp = D.jpApi; saveCfg(); }
      if (withInv || !D.invT || Date.now() - D.invT > 10 * 60000) await fetchInv();
      save('data', D);
      track();
      msgErr && /API|key/i.test(msg) && (msg = '');
    } catch (e) { say('API: ' + e.message, true); }
    busy = false;
    render();
  }
  // job points for your current company type (user/jobpoints)
  function jobPointsOf(u) { const c = u.jobpoints && u.jobpoints.companies, t = u.job && u.job.company_type; if (!c || !t || !c[t]) return null; const v = c[t].jobpoints ?? c[t].points; return v == null ? null : +v; }
  async function fetchInv() {
    const inv = {}, ids = Object.assign({}, (D && D.ids) || {});
    for (const c of ['Drug', 'Candy', 'Booster', 'Special']) {   // Game Console is in «Special»
      try {
        const j = await api(`https://api.torn.com/v2/user/inventory?cat=${c}&limit=250`);
        for (const it of (j.inventory && j.inventory.items) || []) { if (!it.equipped && !it.faction_owned) { inv[it.name] = (inv[it.name] || 0) + (+it.amount || 0); if (it.id) ids[it.name] = +it.id; } }
      } catch (e) { if ([2, 7, 16].includes(e.code)) throw e; }
    }
    D.inv = inv; D.ids = ids; D.invT = Date.now();
  }
  // all gyms with their dots (the API stores them ×10, e.g. 73 = 7.3) – public, read once a day
  async function fetchGyms() {
    const c = load('gyms', null); if (c && Date.now() - c.t < 86400000) return;
    try { const j = await api('https://api.torn.com/torn/?selections=gyms'); const g = {}; for (const id in j.gyms || {}) { const x = j.gyms[id]; g[id] = { n: x.name, e: +x.energy || 10, strength: +x.strength / 10, speed: +x.speed / 10, defense: +x.defense / 10, dexterity: +x.dexterity / 10 }; } save('gyms', { t: Date.now(), g }); } catch (e) { }
  }
  // which stat and dots the estimate uses – automatic: your active gym's best stat (tie → the stat you trained last jump → Speed)
  function gymNow() {
    const all = (load('gyms', null) || {}).g || {}, g = D && all[D.gym]; if (!g) return null;
    const order = [cfg.lastStat, 'speed', 'strength', 'dexterity', 'defense'].filter((k, i, a) => k && a.indexOf(k) === i);
    const best = Math.max(...order.map(k => g[k] || 0)); const stat = order.find(k => (g[k] || 0) === best);
    return { name: g.n, stat, dots: best };
  }
  // job + stars from the API (once a day). Company type names come from torn/companies.
  async function jobFromApi() {
    if (!cfg.coAuto) return;
    if (!D.coId) { if (cfg.co !== 'none') { cfg.co = 'none'; saveCfg(); } return; }
    if (D.jobT && Date.now() - D.jobT < 86400000 && D.jobCo === D.coId) return;
    try {
      let names = load('coNames', null);
      if (!names) { const t = await api('https://api.torn.com/torn/?selections=companies'); names = {}; for (const id in t.companies || {}) names[id] = t.companies[id].name; save('coNames', names); }
      const c = await api(`https://api.torn.com/company/${D.coId}?selections=profile`);
      const p = c.company || {}, nm = names[p.company_type || D.coType] || '';
      const k = Object.keys(COS).find(k => COS[k].n.toLowerCase() === nm.toLowerCase()) || 'none';
      cfg.co = k; cfg.stars = +p.rating || 1; saveCfg();
      D.jobT = Date.now(); D.jobCo = D.coId; D.jobName = nm;
    } catch (e) { /* keep manual settings */ }
  }

  /* =====================================================================
   *  PLAN
   * ===================================================================*/
  const E = () => D ? D.e : 0;
  function plan() {
    const t = cfg.jump, emax = D ? D.emax : 150, base = D && D.hmax ? D.hmax : 0;
    const stackE = Math.min(CAP, Math.max(E(), cfg.xan * 250 + emax));
    const totalE = stackE + (cfg.refill ? emax : 0);
    const conE = t === 'console' ? Math.round(totalE * (hasGamer() ? 0.41 : 0.30) / 5) * 5 : 0;   // best share (Vladar's gym formula)
    const JP = jobPlan();
    const items = t === 'edvd' ? cfg.edvd * dvdH() : cfg.candy * candyH() + (cfg.fin ? dvdH() : 0);
    const target = Math.min(Math.floor(HMAX / 2), base + items + JP.h + conE * (hasGamer() ? 40 : 20));
    const steps = [];
    steps.push({ id: 'xan', nm: 'Xanax', of: cfg.xan, btn: '💊 USE XANAX', item: 'Xanax' });
    if (JP.used.length) steps.push({ id: 'perk', nm: `Job special: ${JP.used.join(' + ')}`, sub: `${cfg.jp} JP → +${fmt(JP.h)} happy`, of: 1, btn: '→ Job specials', nav: 'job' });
    if (t === 'edvd') steps.push({ id: 'dvd', nm: `Erotic DVD (+${fmt(dvdH())})`, of: cfg.edvd, btn: '📀 USE eDVD', item: 'Erotic DVD' });
    else {
      steps.push({ id: 'candy', nm: `${CN()} (+${candyH()})`, of: cfg.candy, btn: '🍬 EAT CANDY', item: CN() });
      if (cfg.fin) steps.push({ id: 'fdvd', nm: `Erotic DVD finisher (+${fmt(dvdH())})`, of: 1, btn: '📀 USE eDVD', item: 'Erotic DVD' });
    }
    if (t === 'console') steps.push({ id: 'con', nm: 'Game Console – Hardcore (5E)', of: Math.round(conE / 5), btn: '🎮 USE CONSOLE', item: 'Game Console', approx: true });
    steps.push({ id: 'ecs', nm: 'Ecstasy', of: 1, btn: '💊 TAKE ECSTASY', item: 'Ecstasy' });
    steps.push({ id: 'gym', nm: 'Gym – train all', of: 1, btn: '🏋 GO TO GYM', nav: 'gym' });
    if (cfg.refill) { steps.push({ id: 'ref', nm: 'Energy refill (30 points)', of: 1, btn: '⚡ REFILL → Points', nav: 'points' }); steps.push({ id: 'gym2', nm: 'Gym – train refill', of: 1, btn: '🏋 GO TO GYM', nav: 'gym' }); }
    return { t, steps, target, totalE, conE, stackE, base };
  }
  // Vladar's gym formula (Torn Wiki), calibrated ×1.045
  const gainPer10 = (S0, H, dots) => (has('regime') ? 1.03 : 1) * 1.045 * dots * 10 * ((3.480061e-7 * Math.log(H + 250) + 3.091619e-6) * S0 + 6.827752e-5 * (H + 250) - 0.0301432);
  function expGain(P) {
    const G = gymNow(); if (!G) return 0;
    let h = Math.min(HMAX, P.target * 2), sp = D && D.stats ? D.stats[G.stat] || 0 : 0, g = 0;
    if (!sp) return 0;
    for (let i = 0; i < Math.floor((P.totalE - P.conE) / 10); i++) { const x = gainPer10(sp, h, G.dots); g += x; sp += x; h = Math.max(0, h - (hasGoal() ? 2.5 : 5)); }
    return g;
  }

  /* =====================================================================
   *  PROGRESS – read from the API (energy, happy, cooldowns, points) + your ✓ clicks
   * ===================================================================*/
  const used = id => (J.used && J.used[id]) || 0;
  function track() {
    if (!D || J.phase === 'idle' || J.phase === 'done') return;
    const P = plan(), s0 = J.start || {}, f = boostF();
    J.used = J.used || {}; J.ok = J.ok || {};
    // Xanax: done when one more would push energy over 1,000 – or as soon as a later step has started
    if (D.e > CAP - 250) J.ok.xan = true;
    // candy / eDVD: counted from the booster cooldown they add (30 min per candy, 6 h per eDVD, scaled by your job)
    const dB = Math.max(0, D.booster - Math.max(0, (s0.booster || 0) - Math.floor((D.t - J.t0) / 1000)));
    J.loc = J.loc || {};
    if (P.t === 'edvd') J.used.dvd = Math.max(J.loc.dvd || 0, Math.round(dB / (21600 * f)));
    else {
      const st = P.steps.find(x => x.id === 'candy'); const c = Math.round(dB / (1800 * f));
      J.used.candy = Math.min(st.of, Math.max(J.loc.candy || 0, c));
      if (cfg.fin) J.used.fdvd = Math.max(J.loc.fdvd || 0, c > st.of ? Math.round((dB - st.of * 1800 * f) / (21600 * f)) : 0);
    }
    if (J.used.candy || J.used.dvd) { J.ok.xan = true; J.ok.perk = true; if (J.phase === 'stacking') J.phase = 'active'; }
    // Ecstasy: happy roughly doubles
    if (!J.ok.ecs && J.preEcs && D.happy >= J.preEcs * 1.7) { J.ok.ecs = true; J.ecsHappy = D.happy; }
    if (!J.ok.ecs) J.preEcs = D.happy;
    if (J.ok.ecs && !J.ecsHappy && J.preEcs && D.happy >= J.preEcs * 1.5) J.ecsHappy = D.happy;
    if (J.ok.ecs && D.e < 10) J.ok.gym = true;
    if (J.ok.gym && !J.ok.ref && (D.points <= (J.ptsGym ?? D.points) - 30 || D.e >= (D.emax || 150) - 5)) J.ok.ref = true;
    if (J.ok.gym && J.ptsGym == null) J.ptsGym = D.points;
    if (J.ok.ref && D.e < 10 && J.refE) J.ok.gym2 = true;
    if (J.ok.ref && D.e >= 10) J.refE = true;
    const all = P.steps.every(st => stepDone(st));
    if (all && J.phase !== 'done') { J.phase = 'done'; J.end = { stats: Object.assign({}, D.stats), t: Date.now() }; const d = k => (J.end.stats[k] || 0) - ((J.start.stats || {})[k] || 0); const top = Object.keys(STATS).sort((a, b) => d(b) - d(a))[0]; if (d(top) > 0) { cfg.lastStat = top; saveCfg(); } ui.min = false; saveUi(); }
    saveJ();
  }
  function stepDone(st) {
    if (J.ok && J.ok[st.id]) return true;
    if (st.id === 'con') return !!(J.ok && J.ok.ecs) || (D && D.happy >= plan().target && J.phase === 'active');
    if (['candy', 'dvd', 'fdvd'].includes(st.id)) return used(st.id) >= st.of;
    return false;
  }
  function lockReason(st) {
    if (st.id === 'xan' && cdNow('drug') > 0) return `Drug cooldown ${hm(cdNow('drug'))}`;
    if (st.id === 'ecs' && cdNow('drug') > 0) return `Drug cooldown ${hm(cdNow('drug'))} – Ecstasy can't be taken yet`;
    if (['candy', 'dvd', 'fdvd'].includes(st.id) && cdNow('booster') > 86400) return 'Booster cooldown over 24h – wait';
    if (st.id === 'ref' && D && D.points < 30) return 'Not enough points (30)';
    return '';
  }
  const SECS = { perk: 30, candy: 2, fdvd: 3, dvd: 3, con: 3, ecs: 10 };
  function tickWarn(P, st) {
    if (!st || !['perk', 'candy', 'dvd', 'con'].includes(st.id) || used('candy') || used('dvd') || (J.ok && J.ok.perk)) return null;
    let need = 30;
    for (const x of P.steps.slice(P.steps.indexOf(st))) { if (x.id === 'ecs') { need += SECS.ecs; break; } need += (SECS[x.id] || 0) * x.of; }
    const left = toTick(); return left < need ? { need, left } : null;
  }
  const inv = n => D && D.inv ? D.inv[n] || 0 : 0;
  function needs(P) {
    const left = id => { const st = P.steps.find(x => x.id === id); return st && !stepDone(st) ? Math.max(0, st.of - used(id)) : 0; };
    const xan = (J.ok && J.ok.xan) || E() > CAP - 250 ? 0 : Math.min(left('xan'), Math.ceil((CAP - 250 - E() + 1) / 250));
    const L = [['Xanax', xan, inv('Xanax')]];
    if (P.t === 'edvd') L.push(['Erotic DVD', left('dvd'), inv('Erotic DVD')]);
    else { L.push([CN(), left('candy'), inv(CN())]); if (cfg.fin) L.push(['Erotic DVD', left('fdvd'), inv('Erotic DVD')]); }
    if (P.t === 'console') L.push(['Game Console', J.ok && J.ok.ecs ? 0 : 1, inv('Game Console')]);
    L.push(['Ecstasy', left('ecs'), inv('Ecstasy')]);
    if (cfg.refill) L.push(['Points (refill)', J.ok && J.ok.ref ? 0 : 30, D ? D.points : 0]);
    return L;
  }
  const missing = P => D && D.inv ? needs(P).filter(([, n, h]) => n > h) : [];
  function waitFor() { const d = cdNow('drug'), b = cfg.jump === 'console' ? 0 : cdNow('booster'); return b > d ? { s: b, why: 'booster' } : { s: d, why: d ? 'drug' : '' }; }

  /* =====================================================================
   *  ACTIONS – one click = one thing (open a Torn page, or mark a step)
   * ===================================================================*/
  function say(t, err) { msg = t; msgErr = !!err; const m = document.getElementById('jpy-msg'); if (m) { m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); } }
  function startJump() {
    if (!key) { setOpen = true; say('Add your API key first (⚙️ Settings).', true); return render(); }
    if (!D) { say('Reading your data from Torn …'); return refresh(true); }
    const w = waitFor(); if (w.s) return say(`Not ready – ${w.why} cooldown ${hm(w.s)} left.`, true);
    if (missing(plan()).length && !missWarned) { missWarned = true; return render(); }
    missWarned = false;
    J = { phase: 'stacking', t0: Date.now(), jump: cfg.jump, used: {}, ok: {}, start: { e: D.e, happy: D.happy, booster: cdNow('booster'), drug: cdNow('drug'), stats: Object.assign({}, D.stats), points: D.points } };
    if (D.e > CAP - 250) { J.ok.xan = true; say(`You already have ${fmt(D.e)} energy – one more Xanax would go over ${fmt(CAP)}, so Xanax is skipped.`); }
    else say('Jump started. Step 1: stack Xanax.');
    saveJ(); render();
  }
  function go(where) { location.href = URLS[where]; }
  function doStep(id) {
    const P = plan(), st = P.steps.find(x => x.id === id); if (!st) return;
    const why = lockReason(st); if (why) return say(why, true);
    if (st.nav) {
      if (st.nav === 'gym') { ui.min = true; saveUi(); }
      if (st.nav === 'gym' && onGym()) { render(); return say('Train with Torn\'s buttons – Jumpy follows your energy.'); }
      return go(st.nav);
    }
    useItem(st);
  }
  // One click = one item, the same request Torn's own «Okay» sends on the Items page (TornTools Quick items does the same).
  // Console: always Hardcore (energy 5).
  const KNOWN_IDS = { 'Xanax': 206, 'Ecstasy': 197, 'Game Console': 104, 'Bag of Chocolate Kisses': 210 };
  const rfc = () => { const m = document.cookie.match(/(?:^|; )rfc_v=([^;]+)/); return m ? m[1] : ''; };
  let using = false, refreshT = 0;
  async function useItem(st) {
    if (using) return;
    const id = (D && D.ids && D.ids[st.item]) || KNOWN_IDS[st.item];
    if (!id) return say(`Could not find ${st.item} in your inventory – press ⟳ and try again.`, true);
    using = true; say(`Using ${st.item} …`);
    const body = new URLSearchParams({ step: 'useItem', id: String(id), itemID: String(id), item: String(id) });
    if (st.id === 'con') body.set('energy', '5');
    let r, txt = '';
    try { txt = await (await fetch(`https://www.torn.com/item.php?rfcv=${rfc()}`, { method: 'POST', body, credentials: 'same-origin', headers: { 'x-requested-with': 'XMLHttpRequest' } })).text(); r = JSON.parse(txt); }
    catch (e) { using = false; return say(`Torn did not answer as expected${txt ? ': ' + txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : ''}. Use the Items page for this one.`, true); }
    using = false;
    const text = String(r.text || r.msg || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!r.success) return say(text || 'Torn said no.', true);
    J.loc = J.loc || {}; J.used = J.used || {}; J.ok = J.ok || {};
    J.loc[st.id] = (J.loc[st.id] || 0) + 1; J.used[st.id] = Math.max(J.used[st.id] || 0, J.loc[st.id]);
    if (D && D.inv) D.inv[st.item] = Math.max(0, (D.inv[st.item] || 0) - (st.id === 'con' ? 0 : 1));
    if (st.id !== 'xan') { J.ok.xan = true; if (J.phase === 'stacking') J.phase = 'active'; }
    if (st.id === 'ecs') { J.preEcs = D ? D.happy : 0; J.ok.ecs = true; J.ecsHappy = 0; }
    if (st.id === 'xan' && D) D.e = Math.min(CAP, D.e + 250);
    if (st.id === 'con' && D) D.e = Math.max(0, D.e - 5);
    saveJ(); say(text || `${st.item} used.`);
    clearTimeout(refreshT); refreshT = setTimeout(() => refresh(false), st.id === 'candy' || st.id === 'con' ? 4000 : 1200);   // read energy/happy/cooldowns after a short pause
    render();
  }
  function markDone(id) {
    J.ok = J.ok || {}; J.ok[id] = true;
    if (id !== 'xan') { J.ok.xan = true; if (J.phase === 'stacking') J.phase = 'active'; }
    const P = plan(); for (const st of P.steps) { if (st.id === id) break; J.ok[st.id] = true; }
    if (id === 'ecs' && D) J.ecsHappy = D.happy;
    if (id === 'gym' && D) J.ptsGym = D.points;
    track(); saveJ(); render();
  }
  function closeJump() { J = { phase: 'idle' }; saveJ(); say('Jump closed. The Next jump box counts down.'); render(); }
  function cancelJump() { if (!confirm('Stop this jump in Jumpy? (Nothing in Torn changes.)')) return; J = { phase: 'idle' }; saveJ(); render(); }

  /* =====================================================================
   *  UI
   * ===================================================================*/
  // white line icon on a yellow gradient – same look as Torn's other chat-bar buttons (rounded top, 38×38)
  const SMILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14.2c1 1.7 2.3 2.5 4 2.5s3-.8 4-2.5"/><path d="M9 9.6v.6M15 9.6v.6" stroke-width="2.4"/></svg>`;
  const CSS = `
  #jpy-btn{position:relative;background:linear-gradient(#e8b923,#8a6500) !important;color:#fff !important}
  #jpy-btn:hover{background:linear-gradient(#f5cc45,#a37a08) !important}
  #jpy-btn svg{stroke:#fff !important;fill:none !important;color:#fff !important}#jpy-btn svg *{stroke:#fff !important;fill:none !important}
  #jpy-btn.jpy-float{position:fixed;right:14px;bottom:184px;z-index:999999;width:44px;height:44px;border:0;border-radius:6px;cursor:pointer;box-shadow:0 2px 10px #000a;display:flex;align-items:center;justify-content:center}
  #jpy-btn .dot{position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#6aa84f;border:1.5px solid #fff;display:none}
  #jpy-btn.run .dot{display:block}
  #jpy{position:fixed;right:8px;top:62px;z-index:999999;width:440px;max-width:calc(100vw - 16px);max-height:calc(100vh - 116px);overflow-y:auto;overscroll-behavior:contain;display:none;flex-direction:column;background:#1b1b1b;color:#ddd;font:13px/1.4 Arial,sans-serif;border:2px solid #f1c232;border-radius:8px;box-shadow:0 6px 20px #000c;text-align:left}
  #jpy *{box-sizing:border-box}
  #jpy.open{display:flex}
  #jpy header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #333;flex-wrap:wrap;background:#141414}
  #jpy header .ttl{font-size:15px;color:#fff;font-weight:bold}#jpy header .ver{color:#777;font-size:11px}#jpy .sp{flex:1}
  #jpy header .ad{order:9;width:100%;color:#888;font-size:10px}#jpy header .ad a{color:#8ab4f8}
  #jpy button,#jpy select,#jpy input{font:13px Arial,sans-serif;color:#eee;background:#2a2a2a;border:1px solid #555;border-radius:4px}
  #jpy button{padding:5px 9px;cursor:pointer;height:auto;line-height:1.3}#jpy button:hover{border-color:#999}
  #jpy select{padding:4px 6px}#jpy input[type=number],#jpy input[type=password]{padding:4px 6px;font-size:16px}
  #jpy input[type=checkbox]{width:17px;height:17px}
  #jpy button.on{background:#7f6000;border-color:#f1c232}
  #jpy .pick{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 9px 0}
  #jpy .pick button{min-height:42px;font-size:14px;font-weight:bold}#jpy .pick button.on{background:#38761d;border-color:#6aa84f;color:#fff}
  #jpy .pick button[aria-disabled]{opacity:.45;cursor:not-allowed}
  #jpy .opts{display:flex;flex-wrap:wrap;gap:8px;padding:7px 9px;border-bottom:1px solid #333;align-items:center;color:#ccc}
  #jpy .stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 9px}
  #jpy .st{background:#222;border:1px solid #333;border-radius:4px;padding:6px 8px;min-width:0}
  #jpy .st .k{font-size:11px;color:#999}#jpy .st .n{font-size:18px;font-weight:bold;color:#fff;white-space:nowrap}#jpy .st .n small{font-size:12px;color:#999;font-weight:normal}
  #jpy .hp{grid-column:1/-1}#jpy .meter{height:9px;background:#333;border-radius:5px;overflow:hidden;margin-top:4px}#jpy .meter i{display:block;height:100%;background:#f1c232}
  #jpy .cd{grid-column:1/-1;display:flex;gap:6px}#jpy .cd .st{flex:1}#jpy .cd .n{font-size:15px}#jpy .cd .n small{display:block;font-size:10px;white-space:normal}
  #jpy .tick{float:right;font-size:12px;font-weight:bold}#jpy .tick.ok{color:#93c47d}#jpy .tick.hot{color:#e06666}
  #jpy .startbar{padding:0 9px 8px;display:grid;gap:5px}
  #jpy .act{min-width:140px;min-height:40px;font-weight:bold;border-radius:5px}
  #jpy .act.go{background:#274e13;border-color:#6aa84f;color:#fff}#jpy .act.warn{background:#7f6000;border-color:#f1c232;color:#fff}
  #jpy .act.lock{color:#777;cursor:not-allowed}#jpy .act.fin{color:#888;background:#262626}#jpy .act.nav{background:#1c3d5a;border-color:#6fa8dc;color:#fff}
  #jpy .startbar .act{width:100%;font-size:15px;min-height:46px}
  #jpy .steps{padding:0 9px 6px}
  #jpy .step{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;padding:7px 4px;border-top:1px solid #2a2a2a}
  #jpy .step .no{width:22px;height:22px;border-radius:50%;background:#333;color:#bbb;display:grid;place-items:center;font-size:11px;font-weight:bold}
  #jpy .step .nm{font-weight:bold;color:#fff}#jpy .step .cnt{font-size:12px;color:#999}
  #jpy .step.done .no{background:#38761d;color:#fff}#jpy .step.done .nm{color:#b6d7a8}
  #jpy .step.now{background:#232a1f;border-radius:4px}#jpy .step.now .no{background:#6aa84f;color:#111}#jpy .step.pre{opacity:.55}
  #jpy .why{grid-column:2/-1;font-size:12px;color:#f1c232}
  #jpy .btns{display:flex;gap:4px;align-items:center}#jpy .ok{min-height:40px;padding:4px 8px}
  #jpy .warnbox{margin:8px 9px 0;padding:8px 10px;border:1px solid #f1c232;background:#2e2600;border-radius:5px;color:#ffe599}
  #jpy .warnbox b{color:#fff}
  #jpy .sum{margin:0 9px 9px;border:1px solid #6aa84f;background:#1f2a1b;border-radius:5px;padding:9px 11px}
  #jpy .sum h3{margin:0 0 5px;font-size:15px;color:#b6d7a8}#jpy .sum .big{font-size:18px;font-weight:bold;color:#fff}
  #jpy .sum dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:4px 0 0}#jpy .sum dt{color:#999}#jpy .sum dd{margin:0;color:#fff}
  #jpy .foot{border-top:1px solid #333;padding:7px 9px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  #jpy .stock{flex-basis:100%;display:flex;flex-wrap:wrap;gap:3px 9px;font-size:12px}#jpy .stock .k{color:#999}#jpy .stock .y{color:#93c47d}#jpy .stock .x{color:#e06666;font-weight:bold}
  #jpy .msg{flex-basis:100%;color:#b6d7a8;min-height:16px}#jpy .msg.err{color:#e06666}
  #jpy .hint{color:#999;font-size:12px}
  #jpy .setp{padding:9px;display:grid;gap:7px}#jpy .setp h4{margin:0;color:#fff;font-size:14px}
  #jpy .setp label{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#ccc}
  #jpy .setp ul{margin:3px 0 0;padding-left:18px}
  #jpy .adv{border:1px solid #444;border-radius:5px;padding:6px 8px;display:grid;gap:7px}#jpy .adv summary{cursor:pointer;color:#ccc}
  #jpy table.tos{border-collapse:collapse;width:100%;font-size:12px}#jpy table.tos th,#jpy table.tos td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}#jpy table.tos th{color:#ffe599;font-weight:normal;white-space:nowrap}
  #jpy hr{border:0;border-top:1px solid #444;width:100%;margin:2px 0}
  #jpy .mini{display:none;padding:6px 9px;gap:8px;align-items:center;cursor:pointer}#jpy .mini:hover{background:#222}#jpy .mini b{color:#fff}#jpy .mini .act{min-width:0;min-height:36px;margin-left:auto;padding:4px 10px}
  #jpy.min{width:330px}#jpy.min .mini{display:flex}#jpy.min .body,#jpy.min header .ad{display:none}
  #jpy.setting .main{display:none}
  @media (max-width:700px){#jpy{right:4px;left:4px;width:auto;top:56px}#jpy.min{width:auto}}`;

  function build() {
    if (!document.body) return;
    if (!document.getElementById('jpy-css')) { const st = document.createElement('style'); st.id = 'jpy-css'; st.textContent = CSS; (document.head || document.body).appendChild(st); }
    if (!document.getElementById('jpy')) { const w = document.createElement('div'); w.id = 'jpy'; w.setAttribute('role', 'region'); w.setAttribute('aria-label', 'Jumpy'); document.body.appendChild(w); w.addEventListener('click', onClick); w.addEventListener('change', onChange); }
    let b = document.getElementById('jpy-btn');
    const ref = document.getElementById('notes_panel_button');            // Torn's own chat-bar button (bottom right)
    if (ref && (!b || b.classList.contains('jpy-float') || !b.isConnected)) {
      if (b) b.remove();
      b = document.createElement('button'); b.type = 'button'; b.id = 'jpy-btn'; b.title = 'Jumpy – happy jump';
      b.className = ref.className;                                         // borrow Torn's size/spacing at runtime
      b.innerHTML = SMILE + '<span class="dot"></span>';
      const svg = ref.querySelector('svg'); if (svg && svg.getAttribute('class')) b.querySelector('svg').setAttribute('class', svg.getAttribute('class'));
      ref.parentElement.insertBefore(b, ref); b.onclick = toggle;
    } else if (!ref && !b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'jpy-btn'; b.title = 'Jumpy – happy jump'; b.className = 'jpy-float';
      b.innerHTML = SMILE + '<span class="dot"></span>'; document.body.appendChild(b); b.onclick = toggle;
    }
    b.classList.toggle('run', J.phase === 'stacking' || J.phase === 'active');
  }
  function toggle() { ui.open = !ui.open; if (ui.open) ui.min = onGym() && J.phase !== 'idle' && J.phase !== 'done'; saveUi(); render(); if (ui.open && key && age() > 60) refresh(); }

  function render() {
    build();
    const w = document.getElementById('jpy'); if (!w) return;
    w.classList.toggle('open', !!ui.open); w.classList.toggle('min', !!ui.min); w.classList.toggle('setting', setOpen);
    if (!ui.open) return;
    const P = plan(), idle = J.phase === 'idle', running = J.phase === 'stacking' || J.phase === 'active', done = J.phase === 'done';
    const firstOpen = idle ? -2 : P.steps.findIndex(st => !stepDone(st));
    const W = waitFor(), sp = specials();
    let h = `<header><span class="ttl">😊 Jumpy</span><span class="ver">v${VERSION}</span>
      <span class="ad">Like the script? Send a Xanax to <a href="https://www.torn.com/profiles.php?XID=4422625" target="_blank">Toppzy [4422625]</a></span><span class="sp"></span>
      ${key ? `<button data-a="ref" title="Read energy, happy and cooldowns now">⟳</button>` : ''}<button data-a="set" class="${setOpen ? 'on' : ''}" title="Settings">⚙️</button><button data-a="min" title="Minimize">${ui.min ? '▢' : '▁'}</button></header>`;
    // compact strip (gym page)
    const cur = idle || done ? null : P.steps[firstOpen];
    const lab = `<span>⚡ <b>${fmt(E())}</b>E · 😊 <b>${fmt(D ? D.happy : 0)}</b></span>`;
    const s0 = (J.start && J.start.stats) || {}, s1 = (J.end && J.end.stats) || {}, gainK = Object.keys(STATS).filter(k => (s1[k] || 0) > (s0[k] || 0)), gainT = gainK.reduce((t, k) => t + s1[k] - s0[k], 0);
    const status = done ? `<span style="color:#93c47d">✓ Jump complete${gainT > 0 ? ` · +${fmt(gainT)} ${gainK.length === 1 ? STATS[gainK[0]] : 'stats'}` : ''}</span>`
      : !key ? '<span style="color:#f1c232">Add API key</span>'
      : W.s ? `<span>Next jump <b style="color:#e06666">${hm(W.s)}</b></span>` : '<span>Next jump <b style="color:#93c47d">Ready now</b></span>';
    h += `<div class="mini" data-a="expand" title="Click to open Jumpy">${cur && cur.nav === 'gym' && onGym() ? `${lab}<span style="margin-left:auto;color:#93c47d">🏋 Train here</span><button class="ok" data-a="done" data-id="${cur.id}" title="Mark this step done">✓</button>`
      : cur ? `${lab}<button class="act ${cur.nav ? 'nav' : 'go'}" data-a="step" data-id="${cur.id}">${cur.btn}</button>` : `${lab}<span style="margin-left:auto">${status}</span>`}</div>`;
    h += `<div class="body">`;
    if (setOpen) h += viewSettings();
    h += `<div class="main">`;
    if (!key) h += `<div class="warnbox">🔑 <b>Add your Torn API key</b> to start – Jumpy reads your energy, happy and cooldowns with it. <button data-a="set">⚙️ Settings</button></div>`;
    h += `<div class="pick">${['console', 'candy', 'edvd'].map(t => `<button data-a="jump" data-j="${t}" class="${cfg.jump === t ? 'on' : ''}" ${running ? 'aria-disabled="true"' : ''}>${{ console: '🎮 Console', candy: '🍬 Candy', edvd: '📀 eDVD' }[t]}</button>`).join('')}</div>`;
    if (sp.length) {
      const JP = jobPlan(), need = sp.find(x => x.n === cfg.spec) || sp[sp.length - 1];
      h += `<div class="opts">${sp.length > 1 ? `<label>Special <select data-c="spec"><option value="auto">Best for my points</option>${sp.map(x => `<option value="${esc(x.n)}" ${cfg.spec === x.n ? 'selected' : ''}>${x.n} (+${fmt(x.h)} / ${x.c} JP)</option>`).join('')}</select></label>` : ''}
        ${D && D.jpApi != null ? `<span>Job points <b style="color:#fff">${cfg.jp}</b> <span class="hint">(from Torn)</span></span>` : `<label>Job points <input type="number" data-c="jp" min="0" max="999" value="${cfg.jp}" style="width:70px"></label>`}${JP.used.length ? `<span class="hint">+${fmt(JP.h)} happy</span>` : `<span class="hint" style="color:#f1c232">${need.n} needs ${need.c} JP</span>`}</div>`;
    }
    if (P.t === 'console' && !hasGamer()) h += `<div class="warnbox">⚠ <b>No Gamer perk.</b> Without a 5★ Toy Shop or Game Shop job the console gives only about half the happy. The plan puts ~30 % of your energy on the console instead of 41 %. <button data-a="set">⚙️ Job in Settings</button></div>`;
    const pct = D ? Math.min(100, J.ok && J.ok.ecs ? 100 : D.happy / Math.max(1, P.target) * 100) : 0, hot = D && D.happy > (D.hmax || 0) && toTick() < 180;
    const nj = running ? `<div class="n" style="color:#f1c232">In progress<small>${J.phase === 'stacking' ? 'stacking Xanax' : 'jump running'}</small></div>`
      : W.s ? `<div class="n" style="color:#e06666">${hm(W.s)}<small>waiting for ${W.why} cooldown</small></div>` : `<div class="n" style="color:#93c47d">${key ? 'Ready now' : '–'}<small>${cfg.jump === 'console' ? 'drug cooldown is 0' : 'drug + booster at 0'}</small></div>`;
    const g = expGain(P);
    h += `<div class="stats">
      <div class="st"><div class="k">Energy</div><div class="n">${fmt(E())} <small>/ ${fmt(D ? D.emax : 0)}</small></div></div>
      <div class="st"><div class="k">Expected gain</div><div class="n" style="color:#f1c232">${g ? '+' + fmt(g) : '–'} <small>${gymNow() ? STATS[gymNow().stat] : ''}</small></div>${gymNow() ? `<div class="k">${esc(gymNow().name)} · ${gymNow().dots} dots</div>` : ''}</div>
      <div class="st hp"><div class="k">Happy ${J.ok && J.ok.ecs ? '(Ecstasy taken)' : '→ target before Ecstasy'}<span class="tick ${hot ? 'hot' : 'ok'}" id="jpy-tick" title="Happy above your max drops back at the next quarter-hour tick">⏱ ${mmss(toTick())} to tick</span></div>
        <div class="n">${fmt(D ? D.happy : 0)} <small>${J.ok && J.ok.ecs ? '' : '/ ' + fmt(P.target)}</small></div><div class="meter"><i style="width:${pct}%"></i></div></div>
      <div class="cd"><div class="st"><div class="k">Drug cooldown</div><div class="n" style="color:${cdNow('drug') ? '#e06666' : '#93c47d'}">${hm(cdNow('drug'))}</div></div>
        <div class="st"><div class="k">Booster cooldown</div><div class="n">${hm(cdNow('booster'))}</div></div>
        <div class="st"><div class="k">Next jump</div>${nj}</div></div></div>`;
    if (idle) {
      const miss = missing(P);
      h += `<div class="startbar">${missWarned && miss.length ? `<div class="warnbox" style="margin:0" role="alert">⚠ <b>Missing in your inventory:</b> ${miss.map(([k, n, x]) => `${n - x} ${esc(k)}`).join(', ')}. The jump will stop at that step. Get them first, or start anyway.<br><button class="act warn" data-a="start" style="min-height:34px;margin-top:5px">Start anyway</button> <button data-a="nomiss">Cancel</button></div>`
        : `<button class="act ${W.s || !key ? 'lock' : 'go'}" data-a="start">▶ START ${{ console: 'CONSOLE', candy: 'CANDY', edvd: 'eDVD' }[cfg.jump]} JUMP</button>`}
        ${W.s ? `<span class="hint">Ready in ${hm(W.s)} (${W.why} cooldown). The plan below is a preview.</span>` : ''}</div>`;
    }
    if (done) {
      const s0 = (J.start && J.start.stats) || {}, s1 = (J.end && J.end.stats) || {}, gained = Object.keys(STATS).filter(k => (s1[k] || 0) > (s0[k] || 0));
      const total = gained.reduce((t, k) => t + s1[k] - s0[k], 0);
      h += `<div class="sum" role="status"><h3>✓ Jump complete</h3><div class="big">${total > 0 ? '+' + fmt(total) : '…'} ${gained.length === 1 ? STATS[gained[0]] : 'stats'}</div>
        <dl>${gained.map(k => `<dt>${STATS[k]}</dt><dd>${fmt(s0[k])} → ${fmt(s1[k])} (+${fmt(s1[k] - s0[k])})</dd>`).join('')}
        <dt>Happy</dt><dd>${fmt(J.preEcs)} → ${fmt(J.ecsHappy)} with Ecstasy</dd>
        <dt>Next jump</dt><dd>${W.s ? `in ${hm(W.s)} (${W.why} cooldown)` : 'ready now'}</dd></dl>
        <button class="act go" data-a="close" style="margin-top:7px">✓ Close – back to waiting</button></div>`;
    }
    h += `<div class="steps">${P.steps.map((st, i) => {
      const dn = !idle && stepDone(st), now = i === firstOpen, later = idle || (firstOpen >= 0 && i > firstOpen), why = dn || later ? '' : lockReason(st);
      const atT = st.id === 'con' && D && D.happy >= P.target && !(J.ok && J.ok.ecs);
      const tw = now && !why ? tickWarn(P, st) : null;
      const cls = dn ? 'fin' : later ? 'lock' : atT || tw ? 'warn' : why ? 'lock' : st.nav ? 'nav' : 'go';
      let cnt = '';
      if (st.id === 'xan') cnt = J.ok && J.ok.xan ? (J.start && J.start.e > CAP - 250 ? 'skipped – energy already high' : 'energy stacked') : `${fmt(E())} / ${fmt(P.stackE)} energy`;
      else if (st.id === 'con') cnt = `happy ${fmt(D ? D.happy : 0)} / ${fmt(P.target)} · ~${st.of} uses`;
      else if (st.of > 1) cnt = `${used(st.id)} of ${st.of}`;
      else cnt = dn ? 'done' : '';
      return `<div class="step ${dn ? 'done' : ''} ${now ? 'now' : ''} ${idle ? 'pre' : ''}"><span class="no">${dn ? '✓' : i + 1}</span>
        <div><div class="nm">${esc(st.nm)}</div><div class="cnt">${st.sub && !dn ? st.sub : cnt}</div></div>
        <div class="btns"><button class="act ${cls}" data-a="step" data-id="${st.id}" ${dn || later || why ? 'aria-disabled="true"' : ''}>${atT ? '✔ AT TARGET' : st.btn}</button>${now ? `<button class="ok" data-a="done" data-id="${st.id}" title="Mark this step done">✓</button>` : ''}</div>
        ${why && now ? `<div class="why">${why}</div>` : ''}${tw ? `<div class="why">⚠ Only ${mmss(tw.left)} to the tick, but this part takes about ${mmss(tw.need)} up to Ecstasy. Happy above max is lost at the tick – wait and start right after it.</div>` : ''}</div>`;
    }).join('')}</div>`;
    h += `<div class="foot">${running ? '<button data-a="cancel">✕ Stop jump</button>' : ''}<div class="stock"><span class="k">Needed for this jump:</span>${D && D.inv ? needs(P).filter(([, n]) => n > 0).map(([k, n, x]) => `<span class="${x >= n ? 'y' : 'x'}" title="You have ${fmt(x)}">${x >= n ? '✓' : '✗'} ${n} ${esc(k)}${x < n ? ` (have ${fmt(x)})` : ''}</span>`).join('') : '<span class="hint">add your API key to check your inventory</span>'}</div>
      <div class="msg ${msgErr ? 'err' : ''}" id="jpy-msg" aria-live="polite">${esc(msg)}</div>
      ${D ? `<span class="hint">Read from Torn ${age() < 60 ? 'just now' : Math.floor(age() / 60) + ' min ago'}. Inventory may be up to 15 min old.</span>` : ''}</div>`;
    h += `</div></div>`;
    w.innerHTML = h;
  }

  function viewSettings() {
    const masked = key ? key.slice(0, 4) + '••••••••' + key.slice(-4) : '';
    const sel = (c, arr, v) => `<select data-c="${c}">${arr.map(n => `<option ${String(v) === String(n) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const j = co();
    return `<div class="setp"><h4>⚙️ Settings</h4>
      <div><b>🔑 Torn API key</b> ${key ? '<span style="color:#93c47d">✓ connected</span>' : '<span style="color:#f1c232">not added</span>'}</div>
      ${key ? `<div>Saved key: <b style="color:#fff">${masked}</b>${IS_PDA && key === pdaKey() ? ' <span class="hint">(from TornPDA)</span>' : ''} <button data-a="delkey">Remove key</button> <button data-a="tos">${tosOpen ? 'Hide' : 'Show'} terms</button></div>`
        : `<div><input id="jpy-key" type="password" autocomplete="off" placeholder="16 characters" style="width:190px"> <button class="act go" data-a="savekey" style="min-width:0;min-height:32px">Save key</button></div>
        <span class="hint">Create a <b>Limited</b> key in Torn: Settings → API Keys (<a href="https://www.torn.com/preferences.php#tab=api" target="_blank" style="color:#8ab4f8">open</a>). Use a separate key just for Jumpy, so you can delete it at any time.</span>`}
      ${!key || tosOpen ? `<table class="tos">
        <tr><th>Data Storage</th><td>Only locally in your browser (script storage). Nothing is stored anywhere else.</td></tr>
        <tr><th>Data Sharing</th><td>Nobody. Nothing is sent to any other site.</td></tr>
        <tr><th>Purpose of Use</th><td>Personal happy-jump helper: show energy, happy, drug and booster cooldowns, the next-jump countdown, items needed and your gain. Nothing happens by itself – every action is one click by you; item buttons use one item per click.</td></tr>
        <tr><th>Key Storage &amp; Sharing</th><td>Stored only in your browser and only sent to api.torn.com. Never shared.</td></tr>
        <tr><th>Key Access Level</th><td><b>Limited</b> – used selections: user (bars, cooldowns, battlestats, profile, money, gym, jobpoints, inventory), company (profile – your job stars), torn (companies, gyms).</td></tr></table>` : ''}
      <hr><b>Jump setup</b> <span class="hint">(used every time)</span>
      <label>Xanax per jump ${sel('xan', [1, 2, 3, 4], cfg.xan)} <span class="hint">energy stops at 1,000 – Xanax is skipped if you already have more than 750</span></label>
      <label>Candy per jump ${sel('candy', [...new Set([24, 36, 48, maxCandy()])], cfg.candy)} <span class="hint">max ${maxCandy()} with your booster cooldown</span></label>
      <label>eDVD per jump ${sel('edvd', [...new Set([3, 4, 5, maxDvd()])], cfg.edvd)}</label>
      <label>Candy type <select data-c="ctype">${Object.entries(CANDY).map(([k, v]) => `<option value="${k}" ${cfg.ctype === k ? 'selected' : ''}>${v[0]} (+${v[1]})</option>`).join('')}</select> <span class="hint">gives +${candyH()} each</span></label>
      <label><input type="checkbox" data-c="refill" ${cfg.refill ? 'checked' : ''}> Energy refill (30 points) after the first training</label>
      <hr><label>My job <select data-c="co">${Object.entries(COS).map(([k, v]) => `<option value="${k}" ${cfg.co === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select>
        ${cfg.co !== 'none' ? `★ ${sel('stars', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cfg.stars)}` : ''}</label>
      <label><input type="checkbox" data-c="coAuto" ${cfg.coAuto ? 'checked' : ''}> Read job and stars from the API${D && D.jobName ? ` <span class="hint">(${esc(D.jobName)})</span>` : ''}</label>
      <div><b>What this gives your jumps</b><ul>${j.sp.map(x => cfg.stars >= x.s ? `<li>${x.n}: +${fmt(x.h)} happy per ${x.c} JP</li>` : `<li class="hint">${x.n} needs ${x.s}★</li>`).join('')}${j.pv.map(x => cfg.stars >= x.s ? `<li>${x.t}</li>` : `<li class="hint">${x.t.split(':')[0]} needs ${x.s}★</li>`).join('')}${!j.sp.length && !j.pv.length ? '<li class="hint">Nothing that helps a happy jump.</li>' : ''}</ul></div>
      <details class="adv"><summary>Advanced</summary>
        <label>Faction Voracity ${sel('vor', [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50], cfg.vor)} % <span class="hint">candy happy</span></label>
        <label><input type="checkbox" data-c="book" ${cfg.book ? 'checked' : ''}> Reading «Yes Please Diabetes» (candy ×2)</label>
        <label><input type="checkbox" data-c="wdd" ${cfg.wdd ? 'checked' : ''}> World Diabetes Day (candy ×3)</label>
        <label><input type="checkbox" data-c="fin" ${cfg.fin ? 'checked' : ''}> End candy with 1 eDVD (+${fmt(dvdH())} happy)</label></details>
      <button class="act go" data-a="set" style="justify-self:start">✓ Done – back to the jump</button></div>`;
  }

  function onClick(ev) {
    const el = ev.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a, id = el.dataset.id;
    switch (a) {
      case 'set': setOpen = !setOpen; return render();
      case 'min': ui.min = !ui.min; saveUi(); return render();
      case 'expand': ui.min = false; saveUi(); return render();
      case 'ref': return refresh(true);
      case 'tos': tosOpen = !tosOpen; return render();
      case 'savekey': { const v = (document.getElementById('jpy-key').value || '').trim(); if (!/^[A-Za-z0-9]{16}$/.test(v)) return say('A Torn API key is 16 letters and numbers.', true); key = v; save('key', v); say('Key saved – reading your data …'); render(); return refresh(true); }
      case 'delkey': if (!confirm('Remove the API key from Jumpy?')) return; key = ''; save('key', ''); D = null; save('data', null); return render();
      case 'jump': if (J.phase === 'stacking' || J.phase === 'active') return say('A jump is running – finish or stop it first.', true); cfg.jump = el.dataset.j; saveCfg(); missWarned = false; if (J.phase === 'done') J = { phase: 'idle' }; return render();
      case 'start': return el.classList.contains('lock') && !missWarned ? say(key ? `Not ready – ${waitFor().why} cooldown ${hm(waitFor().s)} left.` : 'Add your API key first (⚙️ Settings).', true) : startJump();
      case 'nomiss': missWarned = false; return render();
      case 'step': if (el.getAttribute('aria-disabled')) return say(el.classList.contains('fin') ? 'That step is done.' : 'Finish the green step first.', true); return doStep(id);
      case 'done': return markDone(id);
      case 'close': return closeJump();
      case 'cancel': return cancelJump();
    }
  }
  function onChange(ev) {
    const el = ev.target, c = el.dataset && el.dataset.c; if (!c) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['xan', 'candy', 'edvd', 'stars', 'vor', 'jp'].includes(c)) v = Math.max(0, +v || 0);
    if (c === 'co' || c === 'stars') { cfg.coAuto = false; cfg.spec = 'auto'; }
    cfg[c] = v; saveCfg(); render();
  }

  /* =====================================================================
   *  START
   * ===================================================================*/
  build(); render();
  if (key) setTimeout(() => refresh(false), 1500);
  let lastHref = location.href;
  setInterval(() => {
    build();
    if (location.href !== lastHref) { lastHref = location.href; if (ui.open) render(); }
    const t = document.getElementById('jpy-tick');
    if (t) { const s = toTick(); t.textContent = `⏱ ${mmss(s)} to tick`; t.className = 'tick ' + (D && D.happy > (D.hmax || 0) && s < 180 ? 'hot' : 'ok'); }
  }, 1000);
  // read Torn every 20 s while a jump runs and the page is visible, otherwise every 5 min
  setInterval(() => {
    if (!key || document.hidden) return;
    const running = J.phase === 'stacking' || J.phase === 'active';
    if (age() >= (running ? 20 : 300)) refresh(false);
    else if (ui.open && !setOpen && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#jpy'))) render();
  }, 5000);
})();
