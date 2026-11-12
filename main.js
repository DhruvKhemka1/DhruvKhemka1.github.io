(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const body = document.body;
  body.classList.add("mode-home");

  /* =========================================================
     Pages that live on graph nodes
     ========================================================= */
  const PAGES = [
    { id: "about", title: "About" },
    { id: "experience", title: "Experience" },
    { id: "projects", title: "Projects" },
    { id: "toolkit", title: "Toolkit" },
    { id: "contact", title: "Contact" },
  ];
  // Which icosahedron vertex carries each page
  const PAGE_NODES = [5, 9, 3, 10, 7];

  /* =========================================================
     1. Build the particle model
     ========================================================= */
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const randDir = () => {
    const z = rand() * 2 - 1, t = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), r * Math.sin(t), z];
  };

  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const norm = Math.hypot(1, phi);
  const nodes = raw.map(([x, y, z], i) => {
    const j = 0.07;
    const isPage = PAGE_NODES.includes(i);
    return {
      p: [x / norm + gauss() * j, y / norm + gauss() * j, z / norm + gauss() * j],
      r: isPage ? 0.13 + rand() * 0.04 : 0.055 + rand() * 0.04,
    };
  });
  const edges = [];
  for (let i = 0; i < raw.length; i++)
    for (let k = i + 1; k < raw.length; k++) {
      const d = Math.hypot(raw[i][0] - raw[k][0], raw[i][1] - raw[k][1], raw[i][2] - raw[k][2]);
      if (Math.abs(d - 2) < 0.01 && rand() > 0.2) edges.push([i, k]);
    }

  const pts = [];
  const owner = [];
  const add = (x, y, z, b, n) => { pts.push(x, y, z, b); owner.push(n); };

  nodes.forEach((n, ni) => {
    const count = Math.round(n.r * n.r * 230000) + 250;
    for (let i = 0; i < count; i++) {
      const d = randDir();
      const rr = n.r * (0.82 + 0.18 * Math.sqrt(rand()));
      add(n.p[0] + d[0] * rr, n.p[1] + d[1] * rr, n.p[2] + d[2] * rr, 0.35 + rand() * 0.65, ni);
    }
  });
  edges.forEach(([a, b]) => {
    const A = nodes[a], B = nodes[b];
    const len = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]);
    const count = Math.round(len * 1400);
    for (let i = 0; i < count; i++) {
      const t = rand(), s = 0.011;
      add(
        A.p[0] + (B.p[0] - A.p[0]) * t + gauss() * s,
        A.p[1] + (B.p[1] - A.p[1]) * t + gauss() * s,
        A.p[2] + (B.p[2] - A.p[2]) * t + gauss() * s,
        0.3 + rand() * 0.7, -1
      );
    }
  });
  // Orbit rings around page nodes
  PAGE_NODES.forEach((idx) => {
    const n = nodes[idx];
    const R = n.r * 1.7;
    const tilt = 0.5 + rand() * 0.9, spin = rand() * Math.PI;
    for (let i = 0; i < 800; i++) {
      const t = rand() * Math.PI * 2;
      const x = Math.cos(t) * R, z = Math.sin(t) * R;
      const y1 = -z * Math.sin(tilt), z1 = z * Math.cos(tilt);
      const x2 = x * Math.cos(spin) + z1 * Math.sin(spin);
      const z2 = -x * Math.sin(spin) + z1 * Math.cos(spin);
      add(n.p[0] + x2 + gauss() * 0.005, n.p[1] + y1 + gauss() * 0.005, n.p[2] + z2 + gauss() * 0.005, 0.4 + rand() * 0.6, idx);
    }
  });
  for (let i = 0; i < 1600; i++) {
    const d = randDir(), r = 1.1 + rand() * 0.9;
    add(d[0] * r, d[1] * r, d[2] * r, 0.08 + rand() * 0.22, -1);
  }

  const P = new Float32Array(pts);
  const nodeOf = Int8Array.from(owner);
  const N = nodeOf.length;

  // Per-particle animation state
  const cur = new Float32Array(N * 2), start = new Float32Array(N * 2);
  const curB = new Float32Array(N), startB = new Float32Array(N);
  const tgt = new Float32Array(N * 2), tgtB = new Float32Array(N);
  const bgDust = new Uint8Array(N);
  const delay = new Float32Array(N), swirl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delay[i] = Math.random();
    swirl[i] = (Math.random() - 0.5) * 2;
  }

  /* =========================================================
     2. Canvas + layout
     ========================================================= */
  const canvas = document.getElementById("dust");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  let W = 1, H = 1, dpr = 1, acc, img, buf;
  let stageBox = { x: 0, y: 0, w: 0, h: 0 };

  const measureStage = () => {
    const r = stage.getBoundingClientRect();
    stageBox = { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  const resize = () => {
    const vw = canvas.clientWidth || window.innerWidth;
    const vh = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const maxPix = 2.4e6;
    if (vw * vh * dpr * dpr > maxPix) dpr = Math.sqrt(maxPix / (vw * vh));
    W = Math.max(1, Math.round(vw * dpr));
    H = Math.max(1, Math.round(vh * dpr));
    canvas.width = W; canvas.height = H;
    acc = new Float32Array(W * H);
    img = ctx.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    measureStage();
    if (mode === "page" && activePage) layoutPage();
  };

  // Particles start scattered across the screen
  const scatter = () => {
    for (let i = 0; i < N; i++) {
      cur[i * 2] = Math.random() * W;
      cur[i * 2 + 1] = Math.random() * H;
      curB[i] = 0;
    }
  };

  /* =========================================================
     3. Turning a word into particle targets
     ========================================================= */
  const sampleWord = (text, box) => {
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    const oc = document.createElement("canvas");
    oc.width = w; oc.height = h;
    const o = oc.getContext("2d", { willReadFrequently: true });
    const setFont = (fs) => {
      o.font = `800 ${fs}px "Inter Tight", Inter, system-ui, sans-serif`;
      if ("letterSpacing" in o) o.letterSpacing = `${-0.035 * fs}px`;
    };
    let fs = h * 1.15;
    setFont(fs);
    let m = o.measureText(text);
    const fitW = (w * 0.98) / m.width;
    const fitH = (h * 0.96) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
    fs *= Math.min(1, fitW, fitH);
    setFont(fs);
    m = o.measureText(text);
    const textH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    o.fillStyle = "#fff";
    o.fillText(text, 0, (h - textH) / 2 + m.actualBoundingBoxAscent);

    const data = o.getImageData(0, 0, w, h).data;
    const out = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3] > 128) out.push(x, y);
    return out;
  };

  let activePage = null;
  const layoutPage = () => {
    const slot = activePage.querySelector(".title-slot");
    const r = slot.getBoundingClientRect();
    const ox = r.left * dpr, oy = (r.top + window.scrollY) * dpr;
    const pts = sampleWord(activePage.dataset.title, r);
    const M = pts.length / 2;
    for (let i = 0; i < N; i++) {
      if (M && Math.random() < 0.72) {
        const k = ((Math.random() * M) | 0) * 2;
        tgt[i * 2] = ox + pts[k] + (Math.random() - 0.5) * 1.4 * dpr;
        tgt[i * 2 + 1] = oy + pts[k + 1] + (Math.random() - 0.5) * 1.4 * dpr;
        tgtB[i] = 0.3 + Math.random() * 0.45;
        bgDust[i] = 0;
      } else {
        tgt[i * 2] = Math.random() * W;
        tgt[i * 2 + 1] = Math.random() * H;
        tgtB[i] = 0.05 + Math.random() * 0.14;
        bgDust[i] = 1;
      }
    }
  };

  /* =========================================================
     4. Transitions between graph and pages
     ========================================================= */
  let mode = "home";
  let tStart = -1e9;
  const DUR = reduceMotion ? 1 : 1800;
  const begin = (m) => {
    start.set(cur);
    startB.set(curB);
    mode = m;
    tStart = performance.now();
  };

  /* =========================================================
     5. Interaction
     ========================================================= */
  let rotY = 0.6, rotX = -0.25;
  const baseSpin = reduceMotion ? 0 : 0.0025;
  let velY = baseSpin, targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  const mouse = { x: -9999, y: -9999, active: false };
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let hovered = -1, labelHover = -1;
  const hoverAmt = new Float32Array(nodes.length);
  const nodeScr = nodes.map(() => ({ x: 0, y: 0, r: 0, z: 0 }));

  const toCanvas = (cx, cy) => [cx * (W / (canvas.clientWidth || 1)), cy * (H / (canvas.clientHeight || 1))];

  const hit = (x, y) => {
    let best = -1, bestZ = Infinity;
    PAGE_NODES.forEach((n, pi) => {
      const s = nodeScr[n];
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < Math.max(s.r * 1.5, 22 * dpr) && s.z < bestZ) { best = pi; bestZ = s.z; }
    });
    return best;
  };

  window.addEventListener("pointermove", (e) => {
    targetTiltY = (e.clientX / window.innerWidth - 0.5) * 0.6;
    targetTiltX = (e.clientY / window.innerHeight - 0.5) * 0.4;
    [mouse.x, mouse.y] = toCanvas(e.clientX, e.clientY);
    mouse.active = true;
    if (dragging) {
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      velY = (e.clientX - lastX) * 0.0009 + velY * 0.5;
      rotX = Math.max(-1.2, Math.min(1.2, rotX + (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  document.addEventListener("pointerleave", () => (mouse.active = false));

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return;
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    [mouse.x, mouse.y] = toCanvas(e.clientX, e.clientY);
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointerup", (e) => {
    stage.classList.remove("dragging");
    if (dragging && moved < 8 && mode === "home") {
      const [x, y] = toCanvas(e.clientX, e.clientY);
      const p = hit(x, y);
      if (p >= 0) location.hash = "#/" + PAGES[p].id;
    }
    dragging = false;
    if (e.pointerType !== "mouse") mouse.active = false;
  });

  // Floating labels that follow page nodes
  const labelsEl = document.getElementById("labels");
  const labels = PAGES.map((pg, pi) => {
    const a = document.createElement("a");
    a.className = "node-label";
    a.href = "#/" + pg.id;
    a.innerHTML = `<span>0${pi + 1}</span>${pg.title}`;
    a.addEventListener("pointerenter", () => (labelHover = pi));
    a.addEventListener("pointerleave", () => (labelHover = -1));
    a.addEventListener("focus", () => (labelHover = pi));
    a.addEventListener("blur", () => (labelHover = -1));
    labelsEl.appendChild(a);
    return a;
  });

  /* =========================================================
     6. Render loop
     ========================================================= */
  // Ink colour rgb(236,235,230) packed as little-endian ABGR (alpha added per pixel)
  const BASE = (230 << 16) | (235 << 8) | 236;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const frame = (now) => {
    const elapsed = now - tStart;
    const transitioning = elapsed < DUR;
    const inHome = mode === "home";

    // ----- graph rotation + node screen positions -----
    if (!dragging) velY += (baseSpin - velY) * 0.02;
    rotY += velY;
    tiltX += (targetTiltX - tiltX) * 0.05;
    tiltY += (targetTiltY - tiltY) * 0.05;

    const cyA = Math.cos(rotY + tiltY), syA = Math.sin(rotY + tiltY);
    const cxA = Math.cos(rotX + tiltX), sxA = Math.sin(rotX + tiltX);
    const size = Math.min(stageBox.w, stageBox.h) || Math.min(W, H) / dpr;
    const scale = size * dpr * 0.37;
    const camD = 3.2;
    const gcx = (stageBox.x + stageBox.w / 2) * dpr;
    const gcy = (stageBox.y + stageBox.h / 2) * dpr;

    const project = (x, y, z, out) => {
      const x1 = x * cyA + z * syA;
      const z1 = -x * syA + z * cyA;
      const y1 = y * cxA - z1 * sxA;
      const z2 = y * sxA + z1 * cxA;
      const f = camD / (camD + z2);
      out[0] = gcx + x1 * f * scale;
      out[1] = gcy + y1 * f * scale;
      out[2] = z2;
      out[3] = f;
    };
    const tmp = [0, 0, 0, 0];

    if (inHome) {
      nodes.forEach((n, ni) => {
        project(n.p[0], n.p[1], n.p[2], tmp);
        const s = nodeScr[ni];
        s.x = tmp[0]; s.y = tmp[1]; s.z = tmp[2]; s.r = n.r * tmp[3] * scale;
      });
      const settled = elapsed > DUR * 0.7;
      hovered = labelHover >= 0 ? labelHover : (!dragging && mouse.active && settled ? hit(mouse.x, mouse.y) : -1);
    } else {
      hovered = -1;
    }
    stage.classList.toggle("on-node", hovered >= 0);
    for (let ni = 0; ni < nodes.length; ni++) {
      const want = hovered >= 0 && PAGE_NODES[hovered] === ni ? 1 : 0;
      hoverAmt[ni] += (want - hoverAmt[ni]) * 0.12;
    }

    // ----- labels -----
    if (inHome) {
      const labelsShow = !transitioning || elapsed > DUR * 0.6;
      PAGE_NODES.forEach((ni, pi) => {
        const s = nodeScr[ni], el = labels[pi];
        const lx = s.x / dpr - stageBox.x, ly = s.y / dpr - stageBox.y;
        const off = s.r / dpr + 10;
        const lw = el.offsetWidth;
        const left = lx + off + lw > stageBox.w - 4 ? lx - off - lw : lx + off;
        const depth = Math.min(1, Math.max(0, (0.7 - s.z) / 1.4));
        el.style.transform = `translate(${left.toFixed(1)}px, ${(ly - 13).toFixed(1)}px)`;
        el.style.opacity = labelsShow ? (0.3 + 0.7 * depth).toFixed(2) : "0";
        el.style.zIndex = String(Math.round(depth * 10));
        el.classList.toggle("hot", hovered === pi);
      });
    }

    // ----- particles -----
    acc.fill(0);
    const mR = Math.min(W, H) * 0.1, mR2 = mR * mR;
    const scrollPx = window.scrollY * dpr;
    const dotSize = dpr >= 1.3 ? 2 : 1;
    const t = now * 0.0003;

    for (let i = 0; i < N; i++) {
      let tx, ty, tb;
      if (inHome) {
        const o = i * 4;
        project(P[o], P[o + 1], P[o + 2], tmp);
        tx = tmp[0]; ty = tmp[1];
        const depth = 0.35 + 0.65 * Math.min(1, Math.max(0, (1.3 - tmp[2]) / 2.6));
        tb = P[o + 3] * depth;
        const n = nodeOf[i];
        if (n >= 0 && hoverAmt[n] > 0.002) {
          const s = nodeScr[n], k = hoverAmt[n];
          tx = s.x + (tx - s.x) * (1 + 0.28 * k);
          ty = s.y + (ty - s.y) * (1 + 0.28 * k);
          tb *= 1 + 0.9 * k;
        }
      } else if (bgDust[i]) {
        const ph = delay[i] * 40;
        tx = tgt[i * 2] + Math.sin(t + ph) * 8 * dpr;
        ty = tgt[i * 2 + 1] + Math.cos(t * 1.3 + ph) * 8 * dpr;
        tb = tgtB[i];
      } else {
        tx = tgt[i * 2];
        ty = tgt[i * 2 + 1] - scrollPx;
        tb = tgtB[i];
      }

      let x, y, b;
      if (transitioning) {
        let l = (elapsed / DUR - delay[i] * 0.4) / 0.6;
        l = l < 0 ? 0 : l > 1 ? 1 : l;
        const e = ease(l);
        const sx = start[i * 2], sy = start[i * 2 + 1];
        const dx = tx - sx, dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const sw = Math.sin(Math.PI * e) * swirl[i] * Math.min(160 * dpr, len * 0.35);
        x = sx + dx * e - (dy / len) * sw;
        y = sy + dy * e + (dx / len) * sw;
        b = startB[i] + (tb - startB[i]) * e;
      } else {
        x = tx; y = ty; b = tb;
      }
      cur[i * 2] = x; cur[i * 2 + 1] = y; curB[i] = b;

      // cursor pushes dust away
      if (mouse.active) {
        const dx = x - mouse.x, dy = y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < mR2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (1 - d / mR) ** 2 * mR * 0.45;
          x += (dx / d) * push;
          y += (dy / d) * push;
        }
      }

      const px = x | 0, py = y | 0;
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1) continue;
      const a = b * 0.55;
      const k = py * W + px;
      acc[k] += a;
      if (dotSize === 2) { acc[k + 1] += a * 0.5; acc[k + W] += a * 0.5; }
    }

    for (let i = 0; i < acc.length; i++) {
      const v = acc[i];
      buf[i] = v > 0 ? ((Math.min(255, v * 255) << 24) >>> 0) | BASE : 0;
    }
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };

  /* =========================================================
     7. Router (#/about, #/projects, …)
     ========================================================= */
  const sections = {};
  document.querySelectorAll(".page").forEach((s) => (sections[s.dataset.page] = s));
  const barLinks = document.querySelectorAll(".pagebar-links a");
  let showTimer = 0;

  const openPage = (id) => {
    body.classList.remove("mode-home");
    body.classList.add("mode-page");
    Object.values(sections).forEach((s) => {
      s.hidden = s.dataset.page !== id;
      s.classList.remove("shown");
    });
    activePage = sections[id];
    window.scrollTo(0, 0);
    layoutPage();
    begin("page");
    clearTimeout(showTimer);
    showTimer = setTimeout(() => activePage && activePage.classList.add("shown"), reduceMotion ? 0 : 950);
    barLinks.forEach((a) => a.classList.toggle("active", a.dataset.link === id));
    document.title = `${activePage.dataset.title} — Dhruv Khemka`;
  };

  const goHome = () => {
    clearTimeout(showTimer);
    body.classList.remove("mode-page");
    body.classList.add("mode-home");
    Object.values(sections).forEach((s) => { s.hidden = true; s.classList.remove("shown"); });
    activePage = null;
    window.scrollTo(0, 0);
    measureStage();
    begin("home");
    document.title = "Dhruv Khemka";
  };

  const route = () => {
    const id = location.hash.replace(/^#\/?/, "");
    if (sections[id]) openPage(id);
    else if (mode !== "home" || activePage) goHome();
  };

  window.addEventListener("hashchange", route);
  window.addEventListener("resize", resize);

  resize();
  scatter();
  begin("home"); // dust assembles into the graph on load
  requestAnimationFrame(frame);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    measureStage();
    route();
  });

  /* =========================================================
     8. Ticker
     ========================================================= */
  const ticks = [
    ["NYU·GPA", "3.79", "Dean’s List"],
    ["DIST-SORT", "▲3.6×", "vs merge sort"],
    ["ORDER-BOOK", "1000/1000", "randomized tests passed"],
    ["JEE-ADV", "AIR 512", "All India Rank"],
    ["IMO", "GOLD", "Zonal Rank 3"],
    ["CHESS", "▲3", "City · District · State titles"],
    ["TUTOR", "80+", "students graded"],
    ["MATH-CLUB", "50+", "students mentored"],
    ["PROB·LINALG·DSA", "▲", "currently studying"],
  ];
  const tickHTML = ticks
    .map(([l, v, d]) => `<span class="tick"><span class="lbl">${l}</span><b class="${v.startsWith("▲") || v.includes("/") ? "up" : ""}">${v}</b><span class="lbl">${d}</span></span>`)
    .join("");
  document.getElementById("ticker").innerHTML = tickHTML + tickHTML;

  /* =========================================================
     9. Name scramble
     ========================================================= */
  const word = document.querySelector("[data-scramble]");
  if (word && !reduceMotion) {
    const final = word.textContent;
    const glyphs = "ΣΔπλ∫∂01<>/#*+=";
    let f = 0;
    const total = 36;
    const step = () => {
      word.textContent = final
        .split("")
        .map((ch, i) => (ch === " " ? " " : f / total > i / final.length ? ch : glyphs[(Math.random() * glyphs.length) | 0]))
        .join("");
      if (++f <= total) requestAnimationFrame(step);
      else word.textContent = final;
    };
    step();
  }

  /* =========================================================
     10. Card spotlights
     ========================================================= */
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  document.getElementById("year").textContent = new Date().getFullYear();
})();
