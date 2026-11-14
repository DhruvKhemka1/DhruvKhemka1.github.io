(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
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
  const PAGE_NODES = [5, 9, 3, 10, 7]; // icosahedron vertex carrying each page

  /* =========================================================
     1. Build the particle model (the graph)
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
  const adj = nodes.map(() => []);
  edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });

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

  /* ---- Graph levels: the root graph, and the smaller graph inside its Projects node ---- */
  const makeGraph = (g) => Object.assign(g, {
    adj: (() => { const a = g.nodes.map(() => []); g.edges.forEach(([x, y]) => { a[x].push(y); a[y].push(x); }); return a; })(),
    nodeScr: g.nodes.map(() => ({ x: 0, y: 0, r: 0, z: 0 })),
    hoverAmt: new Float32Array(g.nodes.length),
    pulses: null,
  });
  // Spread the same N grains over a different graph, so one level can morph into the next
  const buildGraphDust = (gNodes, gEdges, gPageNodes) => {
    const parts = [];
    gNodes.forEach((n, ni) => parts.push({ w: n.r * n.r * 230000 + 250, f: () => {
      const d = randDir(), rr = n.r * (0.82 + 0.18 * Math.sqrt(rand()));
      return [n.p[0] + d[0] * rr, n.p[1] + d[1] * rr, n.p[2] + d[2] * rr, 0.35 + rand() * 0.65, ni];
    } }));
    gEdges.forEach(([a, b]) => {
      const A = gNodes[a].p, B = gNodes[b].p;
      parts.push({ w: Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * 1400, f: () => {
        const t = rand(), sd = 0.011;
        return [A[0] + (B[0] - A[0]) * t + gauss() * sd, A[1] + (B[1] - A[1]) * t + gauss() * sd, A[2] + (B[2] - A[2]) * t + gauss() * sd, 0.3 + rand() * 0.7, -1];
      } });
    });
    gPageNodes.forEach((idx) => {
      const n = gNodes[idx], R = n.r * 1.7, tilt = 0.5 + rand() * 0.9, sp = rand() * Math.PI;
      parts.push({ w: 900, f: () => {
        const t = rand() * Math.PI * 2, x = Math.cos(t) * R, z = Math.sin(t) * R;
        const y1 = -z * Math.sin(tilt), z1 = z * Math.cos(tilt);
        return [n.p[0] + x * Math.cos(sp) + z1 * Math.sin(sp), n.p[1] + y1, n.p[2] - x * Math.sin(sp) + z1 * Math.cos(sp), 0.4 + rand() * 0.6, idx];
      } });
    });
    parts.push({ w: 9000, f: () => { const d = randDir(), r = 0.5 + rand() * 1.5; return [d[0] * r, d[1] * r, d[2] * r, 0.08 + rand() * 0.2, -1]; } });
    const total = parts.reduce((a, p) => a + p.w, 0);
    const P2 = new Float32Array(N * 4), own = new Int8Array(N);
    let k = 0, accW = parts[0].w;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * total;
      while (u > accW && k < parts.length - 1) accW += parts[++k].w;
      const v = parts[k].f();
      P2[i * 4] = v[0]; P2[i * 4 + 1] = v[1]; P2[i * 4 + 2] = v[2]; P2[i * 4 + 3] = v[3]; own[i] = v[4];
    }
    return { P: P2, nodeOf: own };
  };

  const subNodes = [
    { p: [-0.78, -0.3, 0.12], r: 0.2 }, { p: [0.8, -0.22, -0.18], r: 0.2 }, { p: [0.02, 0.72, 0.2], r: 0.2 },
    { p: [0, 0.02, 0], r: 0.075 }, { p: [0.12, -0.3, -0.75], r: 0.06 }, { p: [-0.25, 0.1, 0.8], r: 0.065 },
    { p: [0.55, 0.55, -0.45], r: 0.055 }, { p: [-0.6, 0.5, -0.35], r: 0.06 },
  ];
  const subEdges = [[0, 1], [1, 2], [2, 0], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [5, 0], [5, 2], [6, 1], [6, 2], [7, 0], [7, 2], [4, 3], [5, 3]];
  const GRAPHS = {
    "": makeGraph({
      id: "", parent: null, nodes, edges, pageNodes: PAGE_NODES, pages: PAGES, P, nodeOf,
      heading: "Dhruv Khemka", tagline: "Algorithms, probability & markets.",
      hint: "Scroll into a node · drag to spin",
    }),
    projects: makeGraph({
      id: "projects", parent: "", nodes: subNodes, edges: subEdges, pageNodes: [0, 1, 2],
      pages: [
        { id: "projects/orderbook", title: "Order Book" },
        { id: "projects/sort", title: "Sort Race" },
        { id: "projects/crossover", title: "Crossover" },
      ],
      ...buildGraphDust(subNodes, subEdges, [0, 1, 2]),
      heading: "Projects", tagline: "Three builds. Scroll into one to run it live.",
      hint: "Scroll into a project · scroll out to go back",
    }),
  };
  let G = GRAPHS[""]; // the graph level currently on screen

  // Per-particle state
  const cur = new Float32Array(N * 2), start = new Float32Array(N * 2);
  const curB = new Float32Array(N), startB = new Float32Array(N);
  const tgt = new Float32Array(N * 2), tgtB = new Float32Array(N);
  const S3 = new Float32Array(N * 3);            // page sculpture coordinates
  const kind = new Uint8Array(N);                // 0 title word · 1 sculpture · 2 ambient
  const offX = new Float32Array(N), offY = new Float32Array(N); // physics offset
  const velX = new Float32Array(N), velY2 = new Float32Array(N);
  const delay = new Float32Array(N), swirl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delay[i] = Math.random();
    swirl[i] = (Math.random() - 0.5) * 2;
  }

  /* =========================================================
     2. A 3D dust sculpture for every page
     ========================================================= */
  const lorenz = (() => {
    const out = [];
    let x = 0.1, y = 0, z = 0;
    const dt = 0.005;
    for (let i = 0; i < 14000; i++) {
      const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - (8 / 3) * z;
      x += dx * dt; y += dy * dt; z += dz * dt;
      if (i > 400) out.push(x / 22, -(z - 25) / 22, y / 22);
    }
    return out;
  })();

  const SHAPES = {
    // Bell curve surface (probability)
    about: () => {
      let x = (rand() * 2 - 1) * 1.25, z = (rand() * 2 - 1) * 1.25;
      if (rand() < 0.75) { if (rand() < 0.5) x = Math.round(x * 5) / 5; else z = Math.round(z * 5) / 5; }
      return [x, 0.55 - 1.35 * Math.exp(-(x * x + z * z) * 2.2), z];
    },
    // Double helix (a timeline, twisted)
    experience: () => {
      const t = rand(), s = rand();
      if (s < 0.84) {
        const a = t * Math.PI * 7, sign = s < 0.42 ? 1 : -1;
        return [Math.cos(a) * 0.6 * sign, (t - 0.5) * 2.4, Math.sin(a) * 0.6 * sign];
      }
      const tq = Math.round(t * 30) / 30, a = tq * Math.PI * 7, u = rand() * 2 - 1;
      return [Math.cos(a) * 0.6 * u, (tq - 0.5) * 2.4, Math.sin(a) * 0.6 * u];
    },
    // Lorenz attractor (chaos, markets)
    projects: () => {
      const k = ((rand() * (lorenz.length / 3)) | 0) * 3;
      return [lorenz[k], lorenz[k + 1], lorenz[k + 2]];
    },
    // Trefoil torus knot
    toolkit: () => {
      const t = rand() * Math.PI * 2;
      const r = 2 + Math.cos(3 * t);
      return [(r * Math.cos(2 * t)) / 2.7 + gauss() * 0.03, Math.sin(3 * t) / 2.7 + gauss() * 0.03, (r * Math.sin(2 * t)) / 2.7 + gauss() * 0.03];
    },
    // Ripple (a signal going out)
    contact: () => {
      let r = Math.sqrt(rand()) * 1.35;
      const a = rand() * Math.PI * 2;
      if (rand() < 0.6) r = Math.round(r * 9) / 9;
      return [r * Math.cos(a), 0.2 - (0.55 * Math.cos(r * 9)) / (1 + 2.2 * r), r * Math.sin(a)];
    },
  };

  /* =========================================================
     3. Canvas + layout
     ========================================================= */
  const canvas = document.getElementById("dust");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  let W = 1, H = 1, dpr = 1, acc, img, buf;
  let stageBox = { x: 0, y: 0, w: 0, h: 0 };
  let step = finePointer ? 1 : 2; // draw every Nth particle on weaker devices

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

  /* =========================================================
     4. Turning a word into particle targets
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
  let demo = null; // live project demo running on the current page, if any
  const docBox = (el) => {
    let x = 0, y = 0;
    for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x * dpr, y: y * dpr, w: el.offsetWidth * dpr, h: el.offsetHeight * dpr };
  };
  // What a demo is allowed to do with its particles (see demos.js)
  const demoApi = {
    idx: new Int32Array(0), box: { x: 0, y: 0, w: 1, h: 1 }, dpr: 1, snap: true, busy: true, scroll: 0,
    set(i, x, y, b) {
      const nx = this.box.x + x, ny = this.box.y + y, j = i * 2;
      if (!this.snap) { offX[i] += tgt[j] - nx; offY[i] += tgt[j + 1] - ny; } // stay put, then spring over
      tgt[j] = nx; tgt[j + 1] = ny; tgtB[i] = b;
    },
    nudge(i, dx, dy) { if (!this.snap) { offX[i] += dx; offY[i] += dy; } },
    kick(i, vx, vy) { if (!this.snap) { velX[i] += vx; velY2[i] += vy; } },
    blast(x, y, power) { if (!this.snap) blast(this.box.x + x, this.box.y + y - this.scroll, power); },
  };
  const layoutPage = () => {
    const slot = activePage.querySelector(".title-slot");
    const r = slot.getBoundingClientRect();
    const ox = r.left * dpr, oy = (r.top + window.scrollY) * dpr;
    const wordPts = sampleWord(activePage.dataset.title, r);
    const M = wordPts.length / 2;
    const shape = SHAPES[activePage.dataset.page];
    const narrow = W / dpr < 820;
    // keep the title equally bright whether the word is small or huge
    const pWord = demo ? 0.3 : 0.58;
    const demoList = [];
    const density = (pWord * N) / Math.max(1, M);
    const wordGain = Math.min(2.6, Math.max(0.5, 0.5 / (density * 0.55)));
    for (let i = 0; i < N; i++) {
      const u = Math.random();
      if (M && u < pWord) {
        const k = ((Math.random() * M) | 0) * 2;
        tgt[i * 2] = ox + wordPts[k] + (Math.random() - 0.5) * 1.4 * dpr;
        tgt[i * 2 + 1] = oy + wordPts[k + 1] + (Math.random() - 0.5) * 1.4 * dpr;
        tgtB[i] = (0.55 + Math.random() * 0.9) * wordGain;
        kind[i] = 0;
      } else if (shape && u < 0.93) {
        const p = shape();
        S3[i * 3] = p[0]; S3[i * 3 + 1] = p[1]; S3[i * 3 + 2] = p[2];
        tgtB[i] = (0.2 + Math.random() * 0.35) * (narrow ? 0.6 : 1);
        kind[i] = 1;
      } else if (demo && u < 0.94) {
        kind[i] = 3;
        demoList.push(i);
      } else {
        tgt[i * 2] = Math.random() * W;
        tgt[i * 2 + 1] = Math.random() * H;
        tgtB[i] = 0.05 + Math.random() * 0.14;
        kind[i] = 2;
      }
    }
    if (demo) {
      demoApi.idx = Int32Array.from(demoList);
      demoApi.box = docBox(activePage.querySelector("[data-stage]"));
      demoApi.dpr = dpr;
      demoApi.snap = true;
      demo.layout();
    }
  };

  /* =========================================================
     5. Transitions
     ========================================================= */
  let mode = "home";
  let tStart = -1e9;
  const DUR = reduceMotion ? 1 : 1900;
  const begin = (m) => {
    start.set(cur);
    startB.set(curB);
    mode = m;
    tStart = performance.now();
  };

  /* =========================================================
     6. Interaction: tilt, drag, hover, shockwaves
     ========================================================= */
  let rotY = 0.6, rotX = -0.25;
  const baseSpin = reduceMotion ? 0 : 0.0025;
  let spin = baseSpin, targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  const mouse = { x: -9999, y: -9999, cx: -100, cy: -100, active: false };
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let hovered = -1, labelHover = -1;
  const waves = [];

  // Zoom camera. zl is log-zoom: 0 = normal, ZIN = inside the focused node, ZOUT = far enough out to leave this level
  const ZIN = Math.log(13), ZOUT = -1.5;
  let zl = 0, zlT = 0, zRate = 0.16, focus = -1, lastWheel = 0;
  let pending = null;      // page we are diving toward (set by a click or link)
  let entering = false;    // a level change has been requested and not yet routed
  let skipDive = false;    // the dive already happened; open the page straight away
  let outAmt = 0;          // 0..1 progress of "scroll up at the top" on a page

  const toCanvas = (cx, cy) => [cx * (W / (canvas.clientWidth || 1)), cy * (H / (canvas.clientHeight || 1))];
  const blast = (x, y, power = 1) => {
    if (reduceMotion) return;
    waves.push({ x, y, t0: performance.now(), power });
    if (waves.length > 4) waves.shift();
  };

  const hit = (x, y) => {
    let best = -1, bestZ = Infinity;
    G.pageNodes.forEach((n, pi) => {
      const s = G.nodeScr[n];
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < Math.max(s.r * 1.5, 22 * dpr) && s.z < bestZ) { best = pi; bestZ = s.z; }
    });
    return best;
  };

  window.addEventListener("pointermove", (e) => {
    targetTiltY = (e.clientX / window.innerWidth - 0.5) * 0.6;
    targetTiltX = (e.clientY / window.innerHeight - 0.5) * 0.4;
    [mouse.x, mouse.y] = toCanvas(e.clientX, e.clientY);
    mouse.cx = e.clientX; mouse.cy = e.clientY;
    mouse.active = true;
    if (dragging) {
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      spin = (e.clientX - lastX) * 0.0009 + spin * 0.5;
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
  const endDrag = (e) => {
    stage.classList.remove("dragging");
    dragging = false;
    if (e.pointerType !== "mouse") mouse.active = false;
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // Click: node → open its page · anywhere else → shockwave
  window.addEventListener("click", (e) => {
    if (e.target.closest("a, button, input, label")) return;
    const [x, y] = toCanvas(e.clientX, e.clientY);
    if (mode === "home" && e.target.closest("#stage")) {
      const wasDrag = moved >= 8;
      moved = 0;
      if (wasDrag) return;
      const p = hit(x, y);
      if (p >= 0) { location.hash = "#/" + G.pages[p].id; return; }
    }
    blast(x, y, 1);
  });

  // Keyboard: 1–5 pages · ←/→ previous/next · Esc home
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input")) return;
    const idx = activePage ? PAGES.findIndex((p) => p.id === activePage.dataset.page.split("/")[0]) : -1;
    if (e.key >= "1" && e.key <= "5") location.hash = "#/" + PAGES[+e.key - 1].id;
    else if (e.key === "Escape") location.hash = "#/" + (parentOf(currentId) || "");
    else if (e.key === "0") location.hash = "#/";
    else if (e.key === "ArrowRight") location.hash = "#/" + PAGES[(idx + 1) % PAGES.length].id;
    else if (e.key === "ArrowLeft" && idx >= 0) location.hash = idx === 0 ? "#/" : "#/" + PAGES[idx - 1].id;
  });

  // Floating labels that follow page nodes (rebuilt whenever the graph level changes)
  const labelsEl = document.getElementById("labels");
  let labels = [];
  const buildLabels = () => {
    labelsEl.innerHTML = "";
    labelHover = -1;
    labels = G.pages.map((pg, pi) => {
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
  };

  // Data pulses that walk the graph's edges
  const getPulses = (g) => g.pulses || (g.pulses = Array.from({ length: reduceMotion ? 0 : Math.min(7, g.edges.length) }, () => {
    const e = g.edges[(Math.random() * g.edges.length) | 0];
    return { a: e[0], b: e[1], p: Math.random(), s: 0.006 + Math.random() * 0.008 };
  }));

  // Scroll = zoom. On a graph: scroll down dives into a node, scroll up backs out a level.
  // On a page: scrolling up while already at the top backs out to the graph it came from.
  const pickFocus = () => {
    if (hovered >= 0) return hovered;
    let best = 0, bestD = Infinity;
    G.pageNodes.forEach((n, pi) => {
      const sc = G.nodeScr[n];
      const d = mouse.active ? Math.hypot(sc.x - mouse.x, sc.y - mouse.y) : sc.z * 1000;
      if (d < bestD) { bestD = d; best = pi; }
    });
    return best;
  };
  const zoomBy = (d) => {
    if (pending || entering || performance.now() - tStart < 1300) return; // also swallows trackpad momentum after a level change
    if (d > 0 && zlT <= 0.05 && zl <= 0.08) focus = pickFocus();
    zlT = Math.max(G.parent != null ? ZOUT * 1.08 : -0.2, Math.min(ZIN * 1.08, zlT + d));
    zRate = 0.16;
    lastWheel = performance.now();
  };
  let lastAnyWheel = 0, gestureFromTop = false;
  window.addEventListener("wheel", (e) => {
    // A new gesture starts after a pause. Only gestures that begin at the very top can zoom a page out,
    // so momentum left over from scrolling up a long page never throws you out of it.
    const tNow = performance.now();
    if (tNow - lastAnyWheel > 160) gestureFromTop = window.scrollY <= 0;
    lastAnyWheel = tNow;
    if (mode === "home") {
      e.preventDefault();
      zoomBy(e.ctrlKey ? -e.deltaY * 0.02 : Math.max(-120, Math.min(120, e.deltaY)) * 0.0042);
    } else if (gestureFromTop && window.scrollY <= 0 && e.deltaY < 0 && !entering && !(e.target.closest && e.target.closest("input"))) {
      outAmt = Math.min(1, outAmt + Math.min(120, -e.deltaY) * 0.0028);
      lastWheel = performance.now();
      if (outAmt >= 1) { entering = true; location.hash = "#/" + (parentOf(currentId) || ""); }
    }
  }, { passive: false });
  // Pinch on touch screens
  let pinch = 0;
  const touchDist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  stage.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { pinch = touchDist(e); dragging = false; } }, { passive: true });
  stage.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    const d = touchDist(e);
    zoomBy(Math.log(d / pinch) * 1.8);
    pinch = d;
  }, { passive: true });
  stage.addEventListener("touchend", () => (pinch = 0), { passive: true });

  // Custom cursor + scroll progress
  const cursorEl = document.querySelector(".cursor");
  const dotEl = document.querySelector(".cursor-dot");
  const progressEl = document.querySelector(".progress");
  let ringX = -100, ringY = -100;
  if (finePointer && !reduceMotion) {
    document.documentElement.classList.add("fx-cursor");
    window.addEventListener("pointerdown", () => cursorEl.classList.add("down"));
    window.addEventListener("pointerup", () => cursorEl.classList.remove("down"));
    document.addEventListener("pointerover", (e) => {
      cursorEl.classList.toggle("link", !!e.target.closest("a, button"));
    });
  }

  /* =========================================================
     7. Render loop
     ========================================================= */
  const INK = (230 << 16) | (235 << 8) | 236; // rgb(236,235,230), little-endian
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const SPRING = 0.035, DAMP = 0.88;
  let lastScrollPx = 0, lastNow = 0, emaDt = 16, slowFrames = 0, lastZv = 0;
  const zmEl = document.querySelector(".zoom-meter"), zmFill = document.querySelector(".zm-fill"), zmLabel = document.querySelector(".zm-label");
  const pagesEl = document.getElementById("pages");

  const frame = (now) => {
    // adaptive quality: thin the dust if the device can't keep up
    const dtMs = lastNow ? now - lastNow : 16;
    lastNow = now;
    if (dtMs < 200) emaDt += (dtMs - emaDt) * 0.05;
    if (emaDt > 27 && step < 3 && ++slowFrames > 90) { step++; slowFrames = 0; emaDt = 16; }

    const elapsed = now - tStart;
    const transitioning = elapsed < DUR;
    const inHome = mode === "home";

    // ----- zoom camera -----
    if (inHome) {
      // time-based easing, so the dive takes the same time at any frame rate
      const zk = Math.min(dtMs, 1000) / 16.67;
      if (!pending && now - lastWheel > 450) zlT += (0 - zlT) * (1 - Math.pow(0.93, zk));
      zl += (zlT - zl) * (1 - Math.pow(1 - zRate, zk));
    } else if (outAmt > 0 && now - lastWheel > 300 && !entering) outAmt = Math.max(0, outAmt - 0.04);
    const Zm = Math.exp(zl);
    const zIn = Math.min(1, Math.max(0, zl / ZIN));
    const zBoost = 1 + 0.3 * Math.max(0, zl);
    const nodes = G.nodes, nodeScr = G.nodeScr, hoverAmt = G.hoverAmt, PAGE_NODES = G.pageNodes, P = G.P, nodeOf = G.nodeOf, adj = G.adj;

    if (!dragging) spin += (baseSpin * (1 - zIn) - spin) * 0.02;
    rotY += spin;
    tiltX += (targetTiltX - tiltX) * 0.05;
    tiltY += (targetTiltY - tiltY) * 0.05;

    // ----- graph camera -----
    const cyA = Math.cos(rotY + tiltY), syA = Math.sin(rotY + tiltY);
    const cxA = Math.cos(rotX + tiltX), sxA = Math.sin(rotX + tiltX);
    const size = Math.min(stageBox.w, stageBox.h) || Math.min(W, H) / dpr;
    const scale = size * dpr * 0.37;
    const camD = 3.2;
    const gcx = (stageBox.x + stageBox.w / 2) * dpr;
    const gcy = (stageBox.y + stageBox.h / 2) * dpr;
    const tmp = [0, 0, 0, 0];
    const project = (x, y, z) => {
      const x1 = x * cyA + z * syA;
      const z1 = -x * syA + z * cyA;
      const y1 = y * cxA - z1 * sxA;
      const z2 = y * sxA + z1 * cxA;
      const f = camD / (camD + z2);
      tmp[0] = gcx + x1 * f * scale;
      tmp[1] = gcy + y1 * f * scale;
      tmp[2] = z2;
      tmp[3] = f;
    };

    let fx = gcx, fy = gcy, pvx = gcx, pvy = gcy;
    if (inHome) {
      nodes.forEach((n, ni) => {
        project(n.p[0], n.p[1], n.p[2]);
        const s = nodeScr[ni];
        s.x = tmp[0]; s.y = tmp[1]; s.z = tmp[2]; s.r = n.r * tmp[3] * scale;
      });
      // zoom about the focused node, sliding it to the centre as we get close
      if (focus >= 0 && zl > 0 && PAGE_NODES[focus] != null) {
        const f = nodeScr[PAGE_NODES[focus]], sm = zIn * zIn * (3 - 2 * zIn);
        fx = f.x; fy = f.y;
        pvx = fx + (gcx - fx) * sm; pvy = fy + (gcy - fy) * sm;
      }
      if (Zm !== 1) for (const sc of nodeScr) { sc.x = pvx + (sc.x - fx) * Zm; sc.y = pvy + (sc.y - fy) * Zm; sc.r *= Zm; }
      // crossing a threshold changes level
      if (!entering && elapsed > 250) {
        if (zl > ZIN * 0.96 && zlT > ZIN * 0.9 && focus >= 0) {
          entering = true; skipDive = true;
          if (pending) setTimeout(route, 0);
          else location.hash = "#/" + G.pages[focus].id;
        } else if (zl < ZOUT * 0.96 && zlT < ZOUT * 0.9 && G.parent != null) {
          entering = true;
          location.hash = "#/" + G.parent;
        }
      }
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
      const labelsShow = elapsed > DUR * 0.6;
      PAGE_NODES.forEach((ni, pi) => {
        const s = nodeScr[ni], el = labels[pi];
        if (!el) return;
        const lx = s.x / dpr - stageBox.x, ly = s.y / dpr - stageBox.y;
        const off = s.r / dpr + 10;
        const lw = el.offsetWidth;
        const left = lx + off + lw > stageBox.w - 4 ? lx - off - lw : lx + off;
        const depth = Math.min(1, Math.max(0, (0.7 - s.z) / 1.4));
        el.style.transform = `translate(${left.toFixed(1)}px, ${(ly - 13).toFixed(1)}px)`;
        const zFade = (focus === pi ? 1 : 1 - zIn) * Math.min(1, Math.max(0, 1 + zl));
        el.style.opacity = labelsShow && el.isConnected ? ((0.3 + 0.7 * depth) * zFade).toFixed(2) : "0";
        el.style.zIndex = String(Math.round(depth * 10));
        el.classList.toggle("hot", hovered === pi);
      });
    }

    // ----- cursor + progress -----
    if (cursorEl && finePointer) {
      ringX += (mouse.cx - ringX) * 0.2;
      ringY += (mouse.cy - ringY) * 0.2;
      cursorEl.style.transform = `translate(${ringX.toFixed(1)}px, ${ringY.toFixed(1)}px)`;
      dotEl.style.transform = `translate(${mouse.cx}px, ${mouse.cy}px)`;
      cursorEl.classList.toggle("on", mouse.active);
      dotEl.classList.toggle("on", mouse.active);
      cursorEl.classList.toggle("node", hovered >= 0);
    }
    if (!inHome) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressEl.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    }
    // zoom meter: how close you are to crossing into the next level
    const zv = inHome ? (zl >= 0 ? zl / ZIN : -zl / ZOUT) : -outAmt;
    if (Math.abs(zv - lastZv) > 0.004) {
      lastZv = zv;
      zmEl.classList.toggle("on", Math.abs(zv) > 0.03);
      zmFill.style.transform = `scaleY(${Math.min(1, Math.abs(zv)).toFixed(3)})`;
      zmLabel.textContent = zv > 0 ? "zoom in" : "zoom out";
      pagesEl.style.transform = !inHome && outAmt > 0 ? `scale(${(1 - 0.07 * outAmt).toFixed(4)})` : "";
      pagesEl.style.opacity = !inHome && outAmt > 0 ? (1 - 0.6 * outAmt).toFixed(3) : "";
    }

    // ----- sculpture camera (page mode) -----
    const wide = W / dpr > 820;
    const scrollPx = window.scrollY * dpr;
    const dScroll = scrollPx - lastScrollPx;
    lastScrollPx = scrollPx;
    const sa = now * 0.00024 + tiltY * 1.4, sb = 0.38 + tiltX * 0.9;
    const scY = Math.cos(sa), ssY = Math.sin(sa), scX = Math.cos(sb), ssX = Math.sin(sb);
    const sax = W * (wide ? 0.74 : 0.5);
    const say = H * (wide ? 0.6 : 0.64) - scrollPx * 0.15;
    const sR = Math.min(W, H) * (wide ? 0.36 : 0.4);

    // ----- let the live demo advance its simulation -----
    if (demo && !inHome) {
      demoApi.snap = transitioning || reduceMotion;
      demoApi.busy = transitioning; // page is still forming: demos wait to start
      demoApi.scroll = scrollPx;
      demo.tick(now);
    }

    // ----- active shockwaves -----
    for (let w = waves.length - 1; w >= 0; w--) if (now - waves[w].t0 > 1100) waves.splice(w, 1);
    const nW = waves.length;
    const band = 70 * dpr;
    const waveR = [], waveP = [];
    for (let w = 0; w < nW; w++) {
      const age = (now - waves[w].t0) / 1100;
      waveR.push(age * Math.hypot(W, H) * 0.75);
      waveP.push(waves[w].power * (1 - age) * 3.4 * dpr);
    }

    acc.fill(0);
    const mR = Math.min(W, H) * 0.11, mR2 = mR * mR;
    const mActive = mouse.active && !reduceMotion;
    const comp = step === 1 ? 0.55 : step === 2 ? 0.9 : 1.2;
    const dotSize = dpr >= 1.3 ? 2 : 1;
    const t = now * 0.0003;
    const tw = now * 0.002;
    const heatScale = 1 / (7 * dpr);
    const scrollKick = !inHome && !transitioning && dScroll !== 0 && Math.abs(dScroll) < 400 * dpr;

    for (let i = 0; i < N; i += step) {
      // --- where this particle wants to be ---
      let tx, ty, tb, glow = 0;
      if (inHome) {
        const o = i * 4;
        project(P[o], P[o + 1], P[o + 2]);
        tx = pvx + (tmp[0] - fx) * Zm; ty = pvy + (tmp[1] - fy) * Zm;
        const depth = 0.35 + 0.65 * Math.min(1, Math.max(0, (1.3 - tmp[2]) / 2.6));
        tb = P[o + 3] * depth * zBoost;
        const n = nodeOf[i];
        if (n >= 0 && hoverAmt[n] > 0.002) {
          const s = nodeScr[n], k = hoverAmt[n];
          tx = s.x + (tx - s.x) * (1 + 0.28 * k);
          ty = s.y + (ty - s.y) * (1 + 0.28 * k);
          tb *= 1 + 0.9 * k;
          glow = k * 0.75;
        }
      } else {
        const kd = kind[i];
        if (kd === 0) {
          tx = tgt[i * 2];
          ty = tgt[i * 2 + 1] - scrollPx + Math.sin(tw + tx * 0.006) * 1.6 * dpr;
          tb = tgtB[i];
        } else if (kd === 1) {
          const o3 = i * 3;
          const X = S3[o3], Y = S3[o3 + 1], Z = S3[o3 + 2];
          const x1 = X * scY + Z * ssY, z1 = -X * ssY + Z * scY;
          const y1 = Y * scX - z1 * ssX, z2 = Y * ssX + z1 * scX;
          const f = 3.2 / (3.2 + z2);
          tx = sax + x1 * f * sR;
          ty = say + y1 * f * sR;
          tb = tgtB[i] * (0.4 + 0.6 * Math.min(1, Math.max(0, (1.2 - z2) / 2.4)));
        } else if (kd === 3) {
          tx = tgt[i * 2];
          ty = tgt[i * 2 + 1] - scrollPx;
          tb = tgtB[i];
        } else {
          const ph = delay[i] * 40;
          tx = tgt[i * 2] + Math.sin(t + ph) * 8 * dpr;
          ty = tgt[i * 2 + 1] + Math.cos(t * 1.3 + ph) * 8 * dpr;
          tb = tgtB[i];
        }
      }

      // --- morph between layouts ---
      let x, y, b;
      if (transitioning) {
        let l = (elapsed / DUR - delay[i] * 0.4) / 0.6;
        l = l < 0 ? 0 : l > 1 ? 1 : l;
        const e = ease(l);
        const sx = start[i * 2], sy = start[i * 2 + 1];
        const dx = tx - sx, dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const arc = Math.sin(Math.PI * e);
        const sw = arc * swirl[i] * Math.min(170 * dpr, len * 0.38);
        x = sx + dx * e - (dy / len) * sw;
        y = sy + dy * e + (dx / len) * sw;
        b = startB[i] + (tb - startB[i]) * e;
        glow += arc * 0.65;
      } else {
        x = tx; y = ty; b = tb;
      }
      cur[i * 2] = x; cur[i * 2 + 1] = y; curB[i] = b;

      // --- springy physics: cursor wake, shockwaves, scroll smear ---
      let ox = offX[i], oy = offY[i], vx = velX[i], vy = velY2[i];
      let forced = false;
      if (mActive) {
        const dx = x + ox - mouse.x, dy = y + oy - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < mR2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / mR) ** 2 * 1.7 * dpr;
          vx += (dx / d) * f; vy += (dy / d) * f;
          forced = true;
        }
      }
      for (let w = 0; w < nW; w++) {
        const dx = x - waves[w].x, dy = y - waves[w].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = Math.abs(d - waveR[w]);
        if (diff < band) {
          const imp = (1 - diff / band) * waveP[w];
          vx += (dx / d) * imp; vy += (dy / d) * imp;
          forced = true;
        }
      }
      if (scrollKick && kind[i] === 0) { oy += dScroll * delay[i] * 0.55; forced = true; }
      if (forced || ox !== 0 || oy !== 0 || vx !== 0 || vy !== 0) {
        vx = (vx - ox * SPRING) * DAMP;
        vy = (vy - oy * SPRING) * DAMP;
        ox += vx; oy += vy;
        if (!forced && Math.abs(ox) + Math.abs(oy) + Math.abs(vx) + Math.abs(vy) < 0.05) { ox = oy = vx = vy = 0; }
        offX[i] = ox; offY[i] = oy; velX[i] = vx; velY2[i] = vy;
        glow += (Math.abs(vx) + Math.abs(vy)) * heatScale;
        x += ox; y += oy;
      }

      // --- draw ---
      const px = x | 0, py = y | 0;
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1) continue;
      if (glow > 1) glow = 1;
      const a = b * comp * (1 + glow * 0.9);
      const k = py * W + px;
      acc[k] += a;
      if (dotSize === 2) { acc[k + 1] += a * 0.5; acc[k + W] += a * 0.5; }
    }

    // ----- data pulses running along edges (home only) -----
    if (inHome && elapsed > DUR * 0.8) {
      const fade = Math.min(1, (elapsed - DUR * 0.8) / 600);
      for (const pl of getPulses(G)) {
        pl.p += pl.s;
        if (pl.p >= 1) {
          const opts = adj[pl.b].filter((n) => n !== pl.a);
          const next = opts.length ? opts[(Math.random() * opts.length) | 0] : pl.a;
          pl.a = pl.b; pl.b = next; pl.p = 0;
          pl.s = 0.006 + Math.random() * 0.008;
        }
        const A = nodes[pl.a].p, B = nodes[pl.b].p;
        for (let tr = 0; tr < 6; tr++) {
          const p = pl.p - tr * 0.025;
          if (p < 0) break;
          project(A[0] + (B[0] - A[0]) * p, A[1] + (B[1] - A[1]) * p, A[2] + (B[2] - A[2]) * p);
          const rad = (3.2 - tr * 0.35) * dpr * tmp[3] * Math.sqrt(Zm);
          const qx = pvx + (tmp[0] - fx) * Zm, qy = pvy + (tmp[1] - fy) * Zm;
          const al = 0.7 * fade * (1 - tr / 6);
          for (let j = 0; j < 46; j++) {
            const px = (qx + (Math.random() + Math.random() - 1) * rad) | 0;
            const py = (qy + (Math.random() + Math.random() - 1) * rad) | 0;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const k = py * W + px;
            acc[k] += al;
          }
        }
      }
    }

    // ----- write pixels: one ink colour, brightness only -----
    for (let i = 0; i < acc.length; i++) {
      const v = acc[i];
      buf[i] = v > 0 ? (((v * 255 > 255 ? 255 : v * 255) << 24) | INK) >>> 0 : 0;
    }
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };

  /* =========================================================
     8. Page-entry effects: heading scramble + stat count-up
     ========================================================= */
  const GLYPHS = "ΣΔπλ∫∂01<>/#*+=";
  const scramble = (el, frames = 28) => {
    if (reduceMotion || el._scrambling) return;
    const final = el.dataset.final || (el.dataset.final = el.textContent);
    el._scrambling = true;
    let f = 0;
    const tick = () => {
      el.textContent = final
        .split("")
        .map((ch, i) => (ch === " " ? " " : f / frames > i / final.length ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
        .join("");
      if (++f <= frames) requestAnimationFrame(tick);
      else { el.textContent = final; el._scrambling = false; }
    };
    tick();
  };

  const countUp = (el) => {
    const final = el.dataset.final || (el.dataset.final = el.textContent);
    const m = final.match(/^(.*?)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m || reduceMotion) return;
    const [, pre, numStr, post] = m;
    const target = parseFloat(numStr.replace(/,/g, ""));
    const decimals = (numStr.split(".")[1] || "").length;
    const commas = numStr.includes(",");
    const t0 = performance.now(), dur = 1300;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const v = target * (1 - Math.pow(1 - p, 4));
      let s = v.toFixed(decimals);
      if (commas) s = Number(s).toLocaleString("en-US");
      el.textContent = pre + s + post;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = final;
    };
    requestAnimationFrame(tick);
  };

  const pageFx = (page) => {
    page.querySelectorAll("h3").forEach((h, i) => setTimeout(() => scramble(h), i * 110));
    page.querySelectorAll("[data-count]").forEach((el, i) => setTimeout(() => countUp(el), 150 + i * 90));
  };

  /* =========================================================
     9. Router (#/about, #/projects, …)
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
    if (demo) { demo.destroy(); demo = null; }
    const makeDemo = window.DEMOS && window.DEMOS[id];
    if (makeDemo) {
      demo = makeDemo(demoApi, {
        stage: activePage.querySelector("[data-stage]"),
        controls: activePage.querySelector("[data-controls]"),
        readout: activePage.querySelector("[data-readout]"),
      });
    }
    window.scrollTo(0, 0);
    lastScrollPx = 0;
    layoutPage();
    begin("page");
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (!activePage) return;
      activePage.classList.add("shown");
      pageFx(activePage);
    }, reduceMotion ? 0 : 950);
    barLinks.forEach((a) => a.classList.toggle("active", a.dataset.link === id.split("/")[0]));
    document.title = `${activePage.dataset.title} — Dhruv Khemka`;
  };

  // Hero text follows the graph level
  const wordEl = document.querySelector("[data-scramble]");
  const setGraph = (g) => {
    G = g;
    buildLabels();
    document.querySelectorAll(".hero-nav").forEach((n) => (n.hidden = n.dataset.nav !== g.id));
    document.getElementById("tagline").textContent = g.tagline;
    document.getElementById("hint").textContent = g.hint;
    if (wordEl.dataset.final !== g.heading) {
      wordEl._scrambling = false;
      wordEl.dataset.final = g.heading;
      wordEl.textContent = g.heading;
      scramble(wordEl, 26);
    }
  };

  let currentId = "";
  const parentOf = (id) => (id.includes("/") ? id.split("/")[0] : id === "" ? null : "");

  const openGraph = (id, prev) => {
    const wasGraph = mode === "home";
    clearTimeout(showTimer);
    body.classList.remove("mode-page");
    body.classList.add("mode-home");
    Object.values(sections).forEach((s) => { s.hidden = true; s.classList.remove("shown"); });
    activePage = null;
    if (demo) { demo.destroy(); demo = null; }
    window.scrollTo(0, 0);
    const g = GRAPHS[id];
    setGraph(g);
    measureStage();
    lastWheel = 0; zlT = 0; zRate = 0.05;
    const from = g.pages.findIndex((p) => p.id === prev);
    if (reduceMotion) { zl = 0; focus = -1; }
    else if (from >= 0) { focus = from; zl = ZIN; zRate = 0.045; }                 // backing out of a child: start inside its node
    else if (g.parent === prev && wasGraph) { focus = -1; zl = Math.log(0.14); }   // diving in from the parent: grow from a speck
    else { focus = -1; zl = id === "" ? 0 : Math.log(0.3); }
    begin("home");
    document.title = id ? `${g.heading} — Dhruv Khemka` : "Dhruv Khemka";
  };

  const route = () => {
    let id = location.hash.replace(/^#\/?/, "");
    if (!GRAPHS[id] && !sections[id]) id = "";
    if (id === currentId && !pending) { entering = false; return; }
    // Stepping into one of this graph's nodes by click or link: dive first, open when we arrive
    if (mode === "home" && !skipDive && !reduceMotion && !pending) {
      const pi = G.pages.findIndex((p) => p.id === id);
      if (pi >= 0) { pending = id; focus = pi; zlT = ZIN * 1.07; zRate = 0.085; return; }
    }
    const prev = currentId;
    skipDive = false; pending = null; entering = false; outAmt = 0;
    currentId = id;
    if (GRAPHS[id]) openGraph(id, prev);
    else openPage(id);
  };

  window.addEventListener("hashchange", route);
  window.addEventListener("resize", resize);

  // Big bang: all dust starts as one bright point, then expands into the graph
  resize();
  const bx = (stageBox.x + stageBox.w / 2) * dpr, by = (stageBox.y + stageBox.h / 2) * dpr;
  for (let i = 0; i < N; i++) {
    cur[i * 2] = bx + (Math.random() - 0.5) * 6 * dpr;
    cur[i * 2 + 1] = by + (Math.random() - 0.5) * 6 * dpr;
    curB[i] = 0.9;
  }
  setGraph(G);
  begin("home");
  requestAnimationFrame(frame);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    measureStage();
    route();
  });

  /* =========================================================
     10. Ticker
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
     11. Wordmark scramble (on load and on hover)
     ========================================================= */
  scramble(wordEl, 40);
  wordEl.addEventListener("pointerenter", () => scramble(wordEl, 22));

  /* =========================================================
     12. Cards: cursor spotlight + 3D tilt · magnetic links
     ========================================================= */
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
      if (finePointer && !reduceMotion) {
        card.style.setProperty("--ry", `${((px - 0.5) * 7).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
      }
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });

  if (finePointer && !reduceMotion) {
    document.querySelectorAll(".hero-nav a, .next, .home-link, .pagebar-links a").forEach((el) => {
      el.classList.add("magnetic");
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.translate = `${(dx * 0.3).toFixed(1)}px ${(dy * 0.4).toFixed(1)}px`;
      });
      el.addEventListener("pointerleave", () => (el.style.translate = "0px 0px"));
    });
  }

  document.getElementById("year").textContent = new Date().getFullYear();
})();
