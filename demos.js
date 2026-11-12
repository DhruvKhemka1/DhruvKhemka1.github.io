/* Live project demos, drawn with the site's dust particles.
 *
 * Each demo is a factory: (api, ui) => { layout(), tick(now), destroy() }
 *   api.idx    Int32Array of particle ids this demo owns
 *   api.box    { w, h } drawing area in canvas pixels
 *   api.dpr    canvas pixels per CSS pixel
 *   api.set(i, x, y, brightness)   move a particle (springs there unless api.snap)
 *   api.nudge(i, dx, dy)           displace a particle; it springs back
 *   api.kick(i, vx, vy)            give a particle velocity
 *   api.blast(x, y, power)         shockwave at a point in the box
 *   ui.stage / ui.controls / ui.readout   DOM containers
 */
window.DEMOS = (() => {
  const R = Math.random;
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = R();
    while (!v) v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clear = (ui) => { ui.stage.innerHTML = ""; ui.controls.innerHTML = ""; ui.readout.innerHTML = ""; };

  /* =========================================================
     1. LIMIT ORDER BOOK — price-time priority matching engine
     ========================================================= */
  const orderbook = (api, ui) => {
    const LV = 17, QMAX = 420, USER_QTY = 80, MKT_QTY = 120;
    const price = (l) => (99.6 + l * 0.05).toFixed(2);
    const bids = Array.from({ length: LV }, () => []);
    const asks = Array.from({ length: LV }, () => []);
    const side = new Int8Array(LV).map((_, l) => (l < LV / 2 ? -1 : 1));
    const fill = new Float32Array(LV);
    const reason = new Array(LV).fill("");
    let nextId = 1, trades = 0, volume = 0, paused = false, lastEvt = 0, lastPx = null;
    const tape = [];

    const total = (q) => q.reduce((s, o) => s + o.qty, 0);
    const bestBid = () => { for (let l = LV - 1; l >= 0; l--) if (bids[l].length) return l; return -1; };
    const bestAsk = () => { for (let l = 0; l < LV; l++) if (asks[l].length) return l; return LV; };

    // --- the engine ---
    const record = (l, q, taker) => {
      trades++; volume += q; lastPx = price(l);
      tape.unshift({ p: price(l), q, taker });
      if (tape.length > 6) tape.length = 6;
      reason[l] = "trade";
    };
    const submit = (s, lvl, qty, rest = true) => {
      if (s === "B") {
        for (let l = bestAsk(); qty > 0 && l <= lvl && l < LV; l = bestAsk()) {
          const o = asks[l][0], f = Math.min(o.qty, qty);
          o.qty -= f; qty -= f; record(l, f, "BUY");
          if (!o.qty) asks[l].shift();           // oldest order at the best price fills first
        }
        if (qty > 0 && rest) { bids[lvl].push({ id: nextId++, qty }); reason[lvl] = reason[lvl] || "add"; }
      } else {
        for (let l = bestBid(); qty > 0 && l >= lvl && l >= 0; l = bestBid()) {
          const o = bids[l][0], f = Math.min(o.qty, qty);
          o.qty -= f; qty -= f; record(l, f, "SELL");
          if (!o.qty) bids[l].shift();
        }
        if (qty > 0 && rest) { asks[lvl].push({ id: nextId++, qty }); reason[lvl] = reason[lvl] || "add"; }
      }
      refresh();
    };
    const cancelRandom = () => {
      const book = R() < 0.5 ? bids : asks;
      const lv = book.map((q, l) => (q.length ? l : -1)).filter((l) => l >= 0);
      if (lv.length < 4) return;
      const l = lv[(R() * lv.length) | 0];
      book[l].splice((R() * book[l].length) | 0, 1);
      reason[l] = "cancel";
      refresh();
    };

    // --- seed book ---
    for (let l = 2; l <= 7; l++) bids[l].push({ id: nextId++, qty: 60 + ((R() * 6) | 0) * 40 });
    for (let l = 9; l <= 14; l++) asks[l].push({ id: nextId++, qty: 60 + ((R() * 6) | 0) * 40 });

    // --- DOM ---
    const rows = [];
    for (let l = 0; l < LV; l++) {
      const row = el("div", "ob-row");
      const b = el("button", "ob-half bid", `<span>+ bid ${USER_QTY}</span>`);
      const a = el("button", "ob-half ask", `<span>+ ask ${USER_QTY}</span>`);
      b.setAttribute("aria-label", `Place bid of ${USER_QTY} at ${price(l)}`);
      a.setAttribute("aria-label", `Place ask of ${USER_QTY} at ${price(l)}`);
      b.addEventListener("click", () => submit("B", l, USER_QTY));
      a.addEventListener("click", () => submit("A", l, USER_QTY));
      const p = el("span", "ob-price mono", price(l));
      row.append(b, p, a);
      ui.stage.appendChild(row);
      rows.push({ row, p });
    }
    const head = el("div", "demo-legend mono small", `<span>◀ bids (buyers)</span><span>asks (sellers) ▶</span>`);
    ui.stage.appendChild(head);

    const btnBuy = el("button", "demo-btn", `Market buy ${MKT_QTY}`);
    const btnSell = el("button", "demo-btn", `Market sell ${MKT_QTY}`);
    const btnPause = el("button", "demo-btn ghost", "Pause flow");
    btnBuy.addEventListener("click", () => submit("B", LV - 1, MKT_QTY, false));
    btnSell.addEventListener("click", () => submit("A", 0, MKT_QTY, false));
    btnPause.addEventListener("click", () => { paused = !paused; btnPause.textContent = paused ? "Resume flow" : "Pause flow"; });
    ui.controls.append(btnBuy, btnSell, btnPause);

    // --- particles ---
    let pl, pu, pv, byLevel = [], geo = null;
    const place = (j) => {
      const l = pl[j], d = side[l], u = pu[j];
      const x = geo.cx + d * (geo.gap / 2 + u * geo.maxLen);
      const y = (LV - 1 - l + 0.5) * geo.rowH + (pv[j] - 0.5) * geo.rowH * 0.58;
      api.set(api.idx[j], x, y, u < fill[l] ? 0.5 + 0.5 * pv[j] : 0.045);
    };

    function refresh() {
      const dpr = api.dpr;
      for (let l = 0; l < LV; l++) {
        const nb = bids[l].length, na = asks[l].length;
        const ns = nb ? -1 : na ? 1 : side[l];
        const nf = Math.min(1, total(nb ? bids[l] : asks[l]) / QMAX);
        if (ns !== side[l] || nf !== fill[l]) {
          const of = fill[l], flipped = ns !== side[l], why = reason[l];
          side[l] = ns; fill[l] = nf;
          if (geo) {
            for (const j of byLevel[l]) {
              const u = pu[j], was = u < of, now = u < nf;
              if (flipped) place(j);
              else if (was !== now) {
                place(j);
                const i = api.idx[j];
                if (now) api.nudge(i, ns * (geo.maxLen * (1 - u) * 0.7 + R() * 40 * dpr), (R() - 0.5) * 26 * dpr); // new liquidity flies in
                else if (why === "trade") api.kick(i, (R() - 0.5) * 16 * dpr, (R() - 0.5) * 16 * dpr);             // filled orders burst
              }
            }
            if (why === "trade") api.blast(geo.cx + ns * (geo.gap / 2 + nf * geo.maxLen), (LV - 1 - l + 0.5) * geo.rowH, 0.16);
          }
        }
        reason[l] = "";
      }
      // readout
      const bb = bestBid(), ba = bestAsk();
      rows.forEach(({ row }, l) => {
        row.classList.toggle("best-bid", l === bb);
        row.classList.toggle("best-ask", l === ba);
      });
      const spread = bb >= 0 && ba < LV ? ((ba - bb) * 0.05).toFixed(2) : "—";
      ui.readout.innerHTML =
        `<div class="stats-row"><span>Best bid <b>${bb >= 0 ? price(bb) : "—"}</b></span><span>Best ask <b>${ba < LV ? price(ba) : "—"}</b></span>` +
        `<span>Spread <b>${spread}</b></span><span>Last <b>${lastPx || "—"}</b></span><span>Trades <b>${trades}</b></span><span>Volume <b>${volume.toLocaleString("en-US")}</b></span></div>` +
        `<div class="tape">${tape.map((t) => `<span class="${t.taker === "BUY" ? "up" : "down"}">${t.taker} ${t.q} @ ${t.p}</span>`).join("") || "<span>waiting for the first trade…</span>"}</div>`;
    }

    const autoFlow = () => {
      const bb = bestBid(), ba = bestAsk();
      const mid = (Math.max(bb, 0) + Math.min(ba, LV - 1)) / 2;
      const pull = (8 - mid) * 0.18; // gentle mean reversion keeps the book on screen
      const q = 20 + ((R() * 5) | 0) * 20;
      const nB = bids.filter((x) => x.length).length, nA = asks.filter((x) => x.length).length;
      const r = R();
      if (nB < 3) submit("B", clamp(Math.round(mid - 1 - R() * 4), 1, LV - 2), 80 + q);
      else if (nA < 3) submit("A", clamp(Math.round(mid + 1 + R() * 4), 1, LV - 2), 80 + q);
      else if (r < 0.4) submit("B", clamp(Math.round(mid + 0.7 + pull - Math.abs(gauss()) * 2.4), 1, LV - 2), q);
      else if (r < 0.8) submit("A", clamp(Math.round(mid - 0.7 + pull + Math.abs(gauss()) * 2.4), 1, LV - 2), q);
      else if (r < 0.9) submit(R() < 0.5 ? "B" : "A", R() < 0.5 ? LV - 1 : 0, q, false);
      else cancelRandom();
    };

    return {
      layout() {
        const n = api.idx.length, dpr = api.dpr, W = api.box.w, H = api.box.h;
        pl = new Uint8Array(n); pu = new Float32Array(n); pv = new Float32Array(n);
        byLevel = Array.from({ length: LV }, () => []);
        for (let j = 0; j < n; j++) { const l = j % LV; pl[j] = l; pu[j] = R(); pv[j] = R(); byLevel[l].push(j); }
        const gap = 70 * dpr;
        geo = { cx: W / 2, gap, rowH: H / LV, maxLen: W / 2 - gap / 2 - 10 * dpr };
        for (let l = 0; l < LV; l++) {
          const q = bids[l].length ? bids[l] : asks[l];
          side[l] = bids[l].length ? -1 : asks[l].length ? 1 : side[l];
          fill[l] = Math.min(1, total(q) / QMAX);
        }
        for (let j = 0; j < n; j++) place(j);
        rows.forEach(({ row }, l) => {
          row.style.top = `${((LV - 1 - l) * geo.rowH) / dpr}px`;
          row.style.height = `${geo.rowH / dpr}px`;
        });
        refresh();
      },
      tick(now) {
        if (!paused && now - lastEvt > 400) { lastEvt = now; autoFlow(); }
      },
      destroy() { clear(ui); },
    };
  };

  /* =========================================================
     2. SORT RACE — distribution sort vs merge sort
     ========================================================= */
  const erf = (x) => {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };

  const sortrace = (api, ui) => {
    let n = 0, vals = [], dataset = "normal", running = false, lastTick = 0, fitText = "";
    const tracks = [
      { name: "Distribution sort", pos: null, frames: [], fi: 0, ops: 0, done: false },
      { name: "Merge sort", pos: null, frames: [], fi: 0, ops: 0, done: false },
    ];
    const flares = [];
    let pt, pe, pu, pv, byElem = [[], []], geo = null;

    const GEN = {
      uniform: () => R(),
      normal: () => 0.5 + gauss() * 0.16,
      exponential: () => -Math.log(1 - R()) * 0.22,
      clustered: () => [0.15, 0.4, 0.68, 0.9][(R() * 4) | 0] + gauss() * 0.025,
    };

    // --- distribution sort: sample → fit a CDF (KS test) → bucket → fix up ---
    const buildDist = () => {
      const fr = [];
      const ids = [...Array(n).keys()];
      const s = Math.min(24, n);
      const sample = ids.slice().sort(() => R() - 0.5).slice(0, s);
      sample.forEach((id) => fr.push({ f: [id], c: 1 }));
      const xs = sample.map((id) => vals[id]).sort((a, b) => a - b);
      const mean = xs.reduce((a, b) => a + b, 0) / s;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / s) || 1e-6;
      const lo = xs[0], hi = xs[s - 1];
      const cands = {
        uniform: (x) => clamp((x - lo) / (hi - lo || 1), 0, 1),
        normal: (x) => 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2))),
        exponential: (x) => (x <= lo ? 0 : 1 - Math.exp(-(x - lo) / (mean - lo || 1e-6))),
      };
      let best = null, bestD = Infinity;
      for (const [name, F] of Object.entries(cands)) {
        let D = 0;
        xs.forEach((x, i) => { D = Math.max(D, Math.abs(F(x) - i / s), Math.abs(F(x) - (i + 1) / s)); });
        if (D < bestD) { bestD = D; best = name; }
      }
      let F;
      if (bestD < 0.2) { F = cands[best]; fitText = `fit: ${best} · KS D=${bestD.toFixed(2)}`; }
      else {
        fitText = `fit: empirical CDF · KS rejected (D=${bestD.toFixed(2)})`;
        F = (x) => {
          if (x <= xs[0]) return 0;
          if (x >= xs[s - 1]) return 1;
          let k = 1;
          while (xs[k] < x) k++;
          return (k - 1 + (x - xs[k - 1]) / (xs[k] - xs[k - 1] || 1)) / (s - 1);
        };
      }
      const bucket = ids.map((id) => Math.min(n - 1, Math.floor(F(vals[id]) * n)));
      ids.forEach((id) => fr.push({ f: [id], c: 2 }));                 // evaluate CDF + count
      const startAt = new Array(n + 1).fill(0);
      bucket.forEach((b) => startAt[b + 1]++);
      for (let b = 0; b < n; b++) startAt[b + 1] += startAt[b];
      const ends = startAt.slice(1), next = startAt.slice(0, n), ord = new Array(n);
      ids.forEach((id) => { const slot = next[bucket[id]]++; ord[slot] = id; fr.push({ m: [[id, slot]], c: 1 }); });
      for (let b = 0; b < n; b++) {                                    // insertion sort inside each bucket
        const s0 = b ? ends[b - 1] : 0, e0 = ends[b];
        for (let i = s0 + 1; i < e0; i++) {
          let j = i, cost = 0;
          while (j > s0) {
            cost++;
            if (vals[ord[j - 1]] > vals[ord[j]]) {
              [ord[j - 1], ord[j]] = [ord[j], ord[j - 1]];
              fr.push({ m: [[ord[j - 1], j - 1], [ord[j], j]], c: cost + 1 });
              cost = 0; j--;
            } else break;
          }
          if (cost) fr.push({ f: [ord[j]], c: cost });
        }
      }
      return fr;
    };

    const buildMerge = () => {
      const fr = [], ord = [...Array(n).keys()];
      const rec = (lo, hi) => {
        if (hi - lo < 2) return;
        const mid = (lo + hi) >> 1;
        rec(lo, mid); rec(mid, hi);
        const L = ord.slice(lo, mid), Rr = ord.slice(mid, hi);
        let a = 0, b = 0;
        for (let k = lo; k < hi; k++) {
          const pick = b >= Rr.length || (a < L.length && vals[L[a]] <= vals[Rr[b]]) ? L[a++] : Rr[b++];
          ord[k] = pick;
          fr.push({ m: [[pick, k]], c: 2 });                          // one compare + one write
        }
      };
      rec(0, n);
      return fr;
    };

    // --- DOM ---
    const labels = tracks.map((t) => { const d = el("div", "sr-label mono small"); ui.stage.appendChild(d); return d; });
    const verdict = el("div", "sr-verdict mono");
    ui.stage.appendChild(verdict);
    const setDataset = (name) => { dataset = name; dsBtns.forEach((b) => b.classList.toggle("on", b.dataset.ds === name)); start(); };
    const dsBtns = Object.keys(GEN).map((name) => {
      const b = el("button", "demo-btn ghost", name[0].toUpperCase() + name.slice(1));
      b.dataset.ds = name;
      b.addEventListener("click", () => setDataset(name));
      return b;
    });
    const again = el("button", "demo-btn", "Race again ↻");
    again.addEventListener("click", () => start());
    ui.controls.append(el("span", "mono small muted", "Data:"), ...dsBtns, again);
    ui.readout.innerHTML = `<p class="muted small">A toy model of the real algorithm: both sorters get the same values and the same budget of element reads and writes per tick, so whoever needs fewer operations finishes first.</p>`;

    const updateLabels = () => {
      tracks.forEach((t, k) => {
        labels[k].innerHTML = `<b>${t.name}</b>${k === 0 ? ` <span class="muted">· ${fitText}</span>` : ""}<br>` +
          `<span class="${t.done ? "up" : ""}">${t.done ? "✓ sorted in " : ""}${t.ops} ops</span>`;
      });
      const [a, b] = tracks;
      verdict.textContent = a.done && b.done ? `${(b.ops / a.ops).toFixed(1)}× ${a.ops <= b.ops ? "fewer" : "more"} operations than merge sort` : "";
    };

    // --- particles ---
    const isFlared = (t, id) => flares.some((f) => f.t === t && f.id === id);
    const place = (j, flare) => {
      const t = pt[j], id = pe[j], g = geo[t];
      const slot = tracks[t].pos[id];
      const x = g.x + (slot + 0.14 + pu[j] * 0.72) * g.sw;
      const y = g.base - pv[j] * vals[id] * g.h;
      api.set(api.idx[j], x, y, flare ? 1 : 0.4 + 0.25 * pv[j]);
    };
    const placeElem = (t, id, flare) => { for (const j of byElem[t][id]) place(j, flare); };

    function start() {
      if (!n) return;
      vals = Array.from({ length: n }, () => clamp(GEN[dataset](), 0.03, 1));
      tracks.forEach((t) => { t.pos = Int16Array.from({ length: n }, (_, i) => i); t.fi = 0; t.ops = 0; t.done = false; });
      tracks[0].frames = buildDist();
      tracks[1].frames = buildMerge();
      flares.length = 0;
      running = true;
      if (pt) for (let j = 0; j < pt.length; j++) place(j, false);
      updateLabels();
    }
    dsBtns.forEach((b) => b.classList.toggle("on", b.dataset.ds === dataset));

    return {
      layout() {
        const dpr = api.dpr, W = api.box.w, H = api.box.h;
        const wide = W / dpr > 640;
        if (!n) { n = wide ? 64 : 40; start(); }
        const cnt = api.idx.length;
        pt = new Uint8Array(cnt); pe = new Uint16Array(cnt); pu = new Float32Array(cnt); pv = new Float32Array(cnt);
        byElem = [Array.from({ length: n }, () => []), Array.from({ length: n }, () => [])];
        for (let j = 0; j < cnt; j++) {
          const t = j & 1, id = (j >> 1) % n;
          pt[j] = t; pe[j] = id; pu[j] = R(); pv[j] = Math.sqrt(R()); byElem[t][id].push(j);
        }
        geo = wide
          ? [0, 1].map((k) => ({ x: W * (0.02 + k * 0.5), sw: (W * 0.46) / n, base: H * 0.95, h: H * 0.7 }))
          : [0, 1].map((k) => ({ x: W * 0.03, sw: (W * 0.94) / n, base: H * (0.47 + k * 0.5), h: H * 0.29 }));
        geo.forEach((g, k) => {
          labels[k].style.left = `${g.x / dpr}px`;
          labels[k].style.top = `${(g.base - g.h) / dpr - 46}px`;
        });
        for (let j = 0; j < cnt; j++) place(j, isFlared(pt[j], pe[j]));
      },
      tick(now) {
        for (let k = flares.length - 1; k >= 0; k--) {
          if (now > flares[k].until) { const f = flares[k]; flares.splice(k, 1); if (!isFlared(f.t, f.id)) placeElem(f.t, f.id, false); }
        }
        if (api.busy || !running || now - lastTick < 45) return;
        lastTick = now;
        tracks.forEach((t, ti) => {
          if (t.done) return;
          let budget = 4;
          while (t.fi < t.frames.length && budget > 0) {
            const fr = t.frames[t.fi++];
            t.ops += fr.c; budget -= fr.c;
            const touched = fr.m ? fr.m.map((m) => m[0]) : fr.f;
            if (fr.m) fr.m.forEach(([id, slot]) => (t.pos[id] = slot));
            touched.forEach((id) => { flares.push({ t: ti, id, until: now + 200 }); placeElem(ti, id, true); });
          }
          if (t.fi >= t.frames.length) {
            t.done = true;
            const g = geo[ti];
            api.blast(g.x + (g.sw * n) / 2, g.base - g.h / 2, 0.35);
          }
        });
        if (tracks.every((t) => t.done)) running = false;
        updateLabels();
      },
      destroy() { clear(ui); },
    };
  };

  /* =========================================================
     3. MOVING-AVERAGE CROSSOVER — golden and death crosses
     ========================================================= */
  const crossover = (api, ui) => {
    const L = 220, SCAN_MS = 7000;
    let p = [], sS = 10, sL = 40, smaS = [], smaL = [], crosses = [];
    let lo = 0, hi = 1, scan = 0, scanning = false, t0 = 0, needStart = true;
    let pg, pu, pn, pm, geo = null;

    const gen = () => {
      p = [100];
      const ph = R() * 6;
      for (let t = 1; t < L; t++) p[t] = p[t - 1] + 0.36 * Math.sin(t / 17 + ph) + 0.22 * Math.sin(t / 41 + ph * 2) + gauss() * 0.55;
      lo = Math.min(...p); hi = Math.max(...p);
    };
    const sma = (w) => {
      const out = new Array(L).fill(NaN);
      let sum = 0;
      for (let t = 0; t < L; t++) { sum += p[t]; if (t >= w) sum -= p[t - w]; if (t >= w - 1) out[t] = sum / w; }
      return out;
    };
    const compute = () => {
      smaS = sma(sS); smaL = sma(sL);
      crosses = [];
      // sign change of (short − long): the same differencing the CLI does
      for (let t = sL; t < L; t++) {
        const d0 = smaS[t - 1] - smaL[t - 1], d1 = smaS[t] - smaL[t];
        if (d0 <= 0 && d1 > 0) crosses.push({ t, v: smaS[t], golden: true, shown: false });
        else if (d0 >= 0 && d1 < 0) crosses.push({ t, v: smaS[t], golden: false, shown: false });
      }
    };
    const at = (arr, t) => {
      const i = Math.min(L - 1, Math.floor(t)), k = Math.min(L - 1, i + 1), f = t - i;
      const a = arr[i], b = arr[k];
      return Number.isNaN(a) ? b : Number.isNaN(b) ? a : a + (b - a) * f;
    };

    // --- DOM ---
    const legend = el("div", "cx-legend mono small");
    const marks = el("div", "cx-marks");
    ui.stage.append(legend, marks);
    const mkSlider = (label, min, max, val, on) => {
      const wrap = el("label", "demo-slider mono small");
      const out = el("b", "", String(val));
      const inp = el("input");
      inp.type = "range"; inp.min = min; inp.max = max; inp.value = val;
      inp.addEventListener("input", () => { out.textContent = inp.value; on(+inp.value); });
      wrap.append(el("span", "", label), inp, out);
      return { wrap, inp, out };
    };
    const short = mkSlider("Short window", 3, 30, sS, (v) => { sS = v; if (sL <= sS) { sL = sS + 5; long.inp.value = sL; long.out.textContent = sL; } retune(); });
    const long = mkSlider("Long window", 20, 100, sL, (v) => { sL = Math.max(v, sS + 5); long.inp.value = sL; long.out.textContent = sL; retune(); });
    const btnNew = el("button", "demo-btn", "New data ↻");
    const btnReplay = el("button", "demo-btn ghost", "Replay ▶");
    btnNew.addEventListener("click", () => { gen(); begin(); });
    btnReplay.addEventListener("click", () => begin());
    ui.controls.append(short.wrap, long.wrap, btnNew, btnReplay);

    const X = (t) => geo.pad + (t / (L - 1)) * (geo.W - 2 * geo.pad);
    const Y = (v) => geo.H * 0.88 - ((v - lo) / (hi - lo || 1)) * geo.H * 0.72;

    const drawMarks = () => {
      if (!geo) return;
      const dpr = api.dpr;
      marks.innerHTML = crosses
        .filter((c) => c.t <= scan)
        .map((c) => `<span class="cx-mark ${c.golden ? "up" : "down"}" style="left:${clamp(X(c.t) / dpr, 34, geo.W / dpr - 34)}px;top:${Y(c.v) / dpr}px">${c.golden ? "▲ golden" : "▼ death"}</span>`)
        .join("");
      const g = crosses.filter((c) => c.golden).length;
      legend.innerHTML = `<span>▓ price</span><span>━ SMA ${sS}</span><span>┅ SMA ${sL}</span>`;
      ui.readout.innerHTML =
        `<div class="stats-row"><span>Golden crosses <b>${g}</b></span><span>Death crosses <b>${crosses.length - g}</b></span><span>Windows <b>${sS} / ${sL}</b></span></div>` +
        `<p class="muted small">Synthetic prices (a random walk) so it runs offline; the crossover detection is the same idea as the CLI: difference the short-above-long indicator and mark every sign change.</p>`;
    };

    const place = (j) => {
      const dpr = api.dpr, g = pg[j], u = pu[j], nz = pn[j];
      const penX = X(scan) + nz * 3 * dpr, i = api.idx[j];
      if (g < 5) {                                   // price
        const t = u * (L - 1);
        if (t <= scan) api.set(i, X(t), Y(at(p, t)) + nz * 2.1 * dpr, 0.42);
        else api.set(i, penX, Y(at(p, scan)) + (u - 0.5) * 8 * dpr, 0.6);
      } else if (g < 7) {                            // short SMA: solid, bright
        const t = sS - 1 + u * (L - sS);
        if (t <= scan) api.set(i, X(t), Y(at(smaS, t)) + nz * 0.9 * dpr, 1);
        else api.set(i, penX, Y(scan >= sS - 1 ? at(smaS, scan) : at(p, scan)), 0.6);
      } else if (g < 9) {                            // long SMA: dashed
        const seg = Math.floor(u * 44), fr = u * 44 - seg;
        const t = sL - 1 + ((seg + fr * 0.58) / 44) * (L - sL);
        if (t <= scan) api.set(i, X(t), Y(at(smaL, t)) + nz * 1.1 * dpr, 0.8);
        else api.set(i, penX, Y(scan >= sL - 1 ? at(smaL, scan) : at(p, scan)), 0.6);
      } else {                                       // crossover rings, spare dust forms the axis
        const c = crosses[pm[j] % 10 | 0];
        if (c && (pm[j] % 10 | 0) < crosses.length) {
          if (c.t <= scan) {
            const a = u * Math.PI * 2, r = (11 + nz * 1.2) * dpr;
            api.set(i, X(c.t) + Math.cos(a) * r, Y(c.v) + Math.sin(a) * r, 1);
          } else api.set(i, penX, Y(at(p, scan)), 0.5);
        } else api.set(i, geo.pad + u * (geo.W - 2 * geo.pad), geo.H * 0.95 + nz * 0.6 * dpr, 0.22);
      }
    };
    const placeAll = () => { if (pg) for (let j = 0; j < pg.length; j++) place(j); };

    function begin() { compute(); scan = 0; scanning = true; t0 = 0; drawMarks(); }
    function retune() {
      compute();
      crosses.forEach((c) => (c.shown = c.t <= scan));
      placeAll();
      drawMarks();
    }
    gen();

    return {
      layout() {
        const cnt = api.idx.length, dpr = api.dpr;
        pg = new Uint8Array(cnt); pu = new Float32Array(cnt); pn = new Float32Array(cnt); pm = new Float32Array(cnt);
        for (let j = 0; j < cnt; j++) { pg[j] = j % 10; pu[j] = R(); pn[j] = gauss(); pm[j] = (j / 10) | 0; }
        geo = { W: api.box.w, H: api.box.h, pad: 18 * dpr };
        if (needStart) { needStart = false; begin(); }
        placeAll();
        drawMarks();
      },
      tick(now) {
        if (!scanning || api.busy) return;
        if (!t0) t0 = now;
        scan = Math.min(L - 1, ((now - t0) / SCAN_MS) * (L - 1));
        placeAll();
        let fresh = false;
        crosses.forEach((c) => {
          if (!c.shown && c.t <= scan) { c.shown = true; fresh = true; api.blast(X(c.t), Y(c.v), 0.14); }
        });
        if (fresh) drawMarks();
        if (scan >= L - 1) { scanning = false; drawMarks(); }
      },
      destroy() { clear(ui); },
    };
  };

  return {
    "projects/orderbook": orderbook,
    "projects/sort": sortrace,
    "projects/crossover": crossover,
  };
})();
