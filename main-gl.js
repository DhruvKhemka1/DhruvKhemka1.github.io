/* Million-grain engine. Every grain is positioned on the graphics card (WebGL2);
 * JavaScript only decides layouts, cameras and the small slice of dust the live demos drive.
 * If WebGL2 is missing or fails, the original engine (main.js) is loaded instead. */
(() => {
  const loadCpuEngine = () => {
    const old = document.getElementById("dust");
    const fresh = old.cloneNode(false);           // a canvas can't switch from WebGL to 2D, so swap it
    old.replaceWith(fresh);
    const s = document.createElement("script");
    s.src = "main.js";
    document.body.appendChild(s);
  };

  const canvas = document.getElementById("dust");
  let gl = null;
  try { gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" }); } catch (e) {}
  if (!gl) return loadCpuEngine();

  /* =========================================================
     0. Shaders
     ========================================================= */
  const VS = `#version 300 es
  precision highp float;
  // A grain has two layouts: where it is coming from (F) and where it is going (T).
  // xyz + brightness, then (mode, node). Modes: 0 graph · 1 title word · 2 sculpture · 3 ambient · 4 demo
  layout(location=0) in vec4 aF; layout(location=1) in vec2 aFM;
  layout(location=2) in vec4 aT; layout(location=3) in vec2 aTM;
  layout(location=4) in vec2 aR;                       // per-grain randoms: delay, swirl
  uniform vec2 uRes; uniform float uDpr, uT, uP, uGainG, uPt, uSmear, uQ;
  uniform vec3 uGeo;                                   // graph centre x, y and scale (pixels)
  uniform vec2 uRotT, uRotF; uniform vec4 uZoomT, uZoomF; uniform vec2 uZmT, uZmF;
  uniform float uScrollT, uScrollF;
  uniform vec4 uSc; uniform vec2 uScRot;               // sculpture anchor x, y, radius · rotation
  uniform vec4 uHover; uniform vec3 uMouse; uniform vec4 uWave[4];
  out float vB;

  vec3 place(vec4 P, vec2 M, vec2 rot, vec4 zm, vec2 zmb, float scroll, bool live) {
    vec2 s; float b = P.w;
    if (M.x < 0.5) {                                   // graph: rotate, project, zoom about the focus node
      float cy = cos(rot.x), sy = sin(rot.x), cx = cos(rot.y), sx = sin(rot.y);
      float x1 = P.x * cy + P.z * sy, z1 = -P.x * sy + P.z * cy;
      float y1 = P.y * cx - z1 * sx, z2 = P.y * sx + z1 * cx;
      float f = 3.2 / (3.2 + z2);
      s = uGeo.xy + vec2(x1, y1) * f * uGeo.z;
      s = zm.zw + (s - zm.xy) * zmb.x;
      b *= (0.35 + 0.65 * clamp((1.3 - z2) / 2.6, 0.0, 1.0)) * zmb.y * uGainG;
      if (live && uHover.w > 0.002 && abs(M.y - uHover.x) < 0.5) {
        s = uHover.yz + (s - uHover.yz) * (1.0 + 0.28 * uHover.w);
        b *= 1.0 + 0.9 * uHover.w;
      }
    } else if (M.x < 1.5) {                            // title word: page space, scrolls with the page
      s = vec2(P.x, P.y - scroll + sin(uT * 2.0 + P.x * 0.006) * 1.6 * uDpr);
      if (live) s.y += uSmear * aR.x * 0.55;
    } else if (M.x < 2.5) {                            // sculpture: its own slow camera
      float cy = cos(uScRot.x), sy = sin(uScRot.x), cx = cos(uScRot.y), sx = sin(uScRot.y);
      float x1 = P.x * cy + P.z * sy, z1 = -P.x * sy + P.z * cy;
      float y1 = P.y * cx - z1 * sx, z2 = P.y * sx + z1 * cx;
      float f = 3.2 / (3.2 + z2);
      s = vec2(uSc.x, uSc.y - scroll * 0.15) + vec2(x1, y1) * f * uSc.z;
      b *= 0.4 + 0.6 * clamp((1.2 - z2) / 2.4, 0.0, 1.0);
    } else if (M.x < 3.5) {                            // ambient: fixed to the screen, drifting
      float ph = aR.x * 40.0;
      s = P.xy + vec2(sin(uT * 0.3 + ph), cos(uT * 0.39 + ph)) * 8.0 * uDpr;
    } else {                                           // demo: page space, positioned by the simulation
      s = vec2(P.x, P.y - scroll);
    }
    return vec3(s, b);
  }

  void main() {
    vec3 A = place(aF, aFM, uRotF, uZoomF, uZmF, uScrollF, false);
    vec3 B = place(aT, aTM, uRotT, uZoomT, uZmT, uScrollT, true);
    float l = clamp((uP - aR.x * 0.4) / 0.6, 0.0, 1.0);
    float e = l < 0.5 ? 4.0 * l * l * l : 1.0 - pow(-2.0 * l + 2.0, 3.0) / 2.0;
    vec2 d = B.xy - A.xy; float len = max(length(d), 1.0);
    float arc = sin(3.14159265 * e);
    float sw = arc * aR.y * min(170.0 * uDpr, len * 0.38);
    vec2 s = A.xy + d * e + vec2(-d.y, d.x) / len * sw;
    float b = mix(A.z, B.z, e) * (1.0 + arc * 0.6);

    vec2 md = s - uMouse.xy; float ml = length(md);    // the cursor pushes dust aside
    if (ml < uMouse.z && ml > 0.001) { float k = 1.0 - ml / uMouse.z; s += md / ml * k * k * uMouse.z * 0.5; }
    for (int i = 0; i < 4; i++) {                      // shockwaves: an expanding ring that shoves dust outward
      vec4 w = uWave[i];
      if (w.w <= 0.0) continue;
      vec2 wd = s - w.xy; float wl = max(length(wd), 0.001);
      float k = 1.0 - abs(wl - w.z) / (70.0 * uDpr);
      if (k > 0.0) { s += wd / wl * k * w.w; b *= 1.0 + k * 0.5; }
    }

    b = min(b * uQ, 1.0);
    if (b < 0.0006) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vB = 0.0; return; }
    gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, 0.0, 1.0);
    gl_PointSize = max(1.0, uDpr * uPt);
    vB = b;
  }`;
  const FS = `#version 300 es
  precision mediump float;
  in float vB; out vec4 o;
  void main() { o = vec4(vec3(0.925, 0.922, 0.902) * vB, vB); }`;
  // tiny second program for the pulses that run along graph edges
  const VS2 = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aP; uniform vec2 uRes; uniform float uDpr; out float vB;
  void main() { gl_Position = vec4(aP.x / uRes.x * 2.0 - 1.0, 1.0 - aP.y / uRes.y * 2.0, 0.0, 1.0); gl_PointSize = max(1.0, uDpr); vB = aP.z; }`;

  let prog, prog2;
  try {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const link = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    prog = link(VS, FS);
    prog2 = link(VS2, FS);
  } catch (e) {
    console.warn("WebGL engine unavailable, using the CPU engine:", e.message);
    return loadCpuEngine();
  }
  const U = {};
  ["uRes","uDpr","uT","uP","uGainG","uPt","uSmear","uQ","uGeo","uRotT","uRotF","uZoomT","uZoomF","uZmT","uZmF","uScrollT","uScrollF","uSc","uScRot","uHover","uMouse","uWave"]
    .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
  const U2 = { uRes: gl.getUniformLocation(prog2, "uRes"), uDpr: gl.getUniformLocation(prog2, "uDpr") };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const body = document.body;
  body.classList.add("mode-home");

  const N = finePointer ? 1000000 : 350000;           // grains
  const STRIDE = 6;                                    // floats per grain per layout

  /* =========================================================
     1. Graph levels
     ========================================================= */
  const PAGES = [
    { id: "about", title: "About" },
    { id: "experience", title: "Experience" },
    { id: "projects", title: "Projects" },
    { id: "toolkit", title: "Toolkit" },
    { id: "contact", title: "Contact" },
  ];
  const PAGE_NODES = [5, 9, 3, 10, 7];

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const R = Math.random;
  const gauss = (r = R) => {
    let u = 0, v = 0;
    while (!u) u = r();
    while (!v) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // root graph: the same seeded icosahedron as the original engine
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const norm = Math.hypot(1, phi);
  const rootNodes = raw.map(([x, y, z], i) => ({
    p: [x / norm + gauss(rand) * 0.07, y / norm + gauss(rand) * 0.07, z / norm + gauss(rand) * 0.07],
    r: PAGE_NODES.includes(i) ? 0.13 + rand() * 0.04 : 0.055 + rand() * 0.04,
  }));
  const rootEdges = [];
  for (let i = 0; i < raw.length; i++)
    for (let k = i + 1; k < raw.length; k++) {
      const d = Math.hypot(raw[i][0] - raw[k][0], raw[i][1] - raw[k][1], raw[i][2] - raw[k][2]);
      if (Math.abs(d - 2) < 0.01 && rand() > 0.2) rootEdges.push([i, k]);
    }
  const subNodes = [
    { p: [-0.78, -0.3, 0.12], r: 0.2 }, { p: [0.8, -0.22, -0.18], r: 0.2 }, { p: [0.02, 0.72, 0.2], r: 0.2 },
    { p: [0, 0.02, 0], r: 0.075 }, { p: [0.12, -0.3, -0.75], r: 0.06 }, { p: [-0.25, 0.1, 0.8], r: 0.065 },
    { p: [0.55, 0.55, -0.45], r: 0.055 }, { p: [-0.6, 0.5, -0.35], r: 0.06 },
  ];
  const subEdges = [[0, 1], [1, 2], [2, 0], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [5, 0], [5, 2], [6, 1], [6, 2], [7, 0], [7, 2], [4, 3], [5, 3]];

  // Scatter all N grains over a graph. Each grain picks its structure at random,
  // so any slice of the buffer is an even sample of the whole graph.
  const buildGraphLayout = (gNodes, gEdges, gPageNodes, ambientW) => {
    const parts = [];
    gNodes.forEach((n, ni) => parts.push({ w: n.r * n.r * 230000 + 250, f: (o, i) => {
      const z = R() * 2 - 1, t = R() * 6.2831853, q = Math.sqrt(1 - z * z);
      const rr = n.r * (0.8 + 0.2 * Math.sqrt(R()));          // a hollow, stippled shell you can see through
      o[i] = n.p[0] + q * Math.cos(t) * rr; o[i + 1] = n.p[1] + q * Math.sin(t) * rr; o[i + 2] = n.p[2] + z * rr;
      o[i + 3] = 0.35 + R() * 0.65; o[i + 5] = ni;
    } }));
    gEdges.forEach(([a, b]) => {
      const A = gNodes[a].p, B = gNodes[b].p;
      parts.push({ w: Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * 1400, f: (o, i) => {
        const t = R(), sd = 0.011;
        o[i] = A[0] + (B[0] - A[0]) * t + gauss() * sd; o[i + 1] = A[1] + (B[1] - A[1]) * t + gauss() * sd; o[i + 2] = A[2] + (B[2] - A[2]) * t + gauss() * sd;
        o[i + 3] = 0.3 + R() * 0.7; o[i + 5] = -1;
      } });
    });
    gPageNodes.forEach((idx) => {
      const n = gNodes[idx], rr = n.r * 1.7, tilt = 0.5 + rand() * 0.9, sp = rand() * Math.PI;
      parts.push({ w: 900, f: (o, i) => {
        const t = R() * 6.2831853, x = Math.cos(t) * rr, z = Math.sin(t) * rr;
        const y1 = -z * Math.sin(tilt), z1 = z * Math.cos(tilt);
        o[i] = n.p[0] + x * Math.cos(sp) + z1 * Math.sin(sp) + gauss() * 0.004; o[i + 1] = n.p[1] + y1 + gauss() * 0.004; o[i + 2] = n.p[2] - x * Math.sin(sp) + z1 * Math.cos(sp) + gauss() * 0.004;
        o[i + 3] = 0.45 + R() * 0.55; o[i + 5] = idx;
      } });
    });
    parts.push({ w: ambientW, f: (o, i) => {
      const z = R() * 2 - 1, t = R() * 6.2831853, q = Math.sqrt(1 - z * z), r = 0.7 + R() * 1.5;
      o[i] = q * Math.cos(t) * r; o[i + 1] = q * Math.sin(t) * r; o[i + 2] = z * r; o[i + 3] = 0.07 + R() * 0.2; o[i + 5] = -1;
    } });
    const cum = []; let total = 0;
    parts.forEach((p) => cum.push((total += p.w)));
    const L = new Float32Array(N * STRIDE);
    for (let i = 0; i < N; i++) {
      const u = R() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
      parts[lo].f(L, i * STRIDE);                         // mode (L[i+4]) stays 0 = graph
    }
    return L;
  };

  const makeGraph = (g) => Object.assign(g, {
    adj: (() => { const a = g.nodes.map(() => []); g.edges.forEach(([x, y]) => { a[x].push(y); a[y].push(x); }); return a; })(),
    nodeScr: g.nodes.map(() => ({ x: 0, y: 0, r: 0, z: 0 })),
    hoverAmt: new Float32Array(g.nodes.length),
    pulses: null,
  });
  const GRAPHS = {
    "": makeGraph({
      id: "", parent: null, nodes: rootNodes, edges: rootEdges, pageNodes: PAGE_NODES, pages: PAGES,
      L: buildGraphLayout(rootNodes, rootEdges, PAGE_NODES, 5000),
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
      L: buildGraphLayout(subNodes, subEdges, [0, 1, 2], 9000),
      heading: "Projects", tagline: "Three builds. Scroll into one to run it live.",
      hint: "Scroll into a project · scroll out to go back",
    }),
  };
  let G = GRAPHS[""];

  /* =========================================================
     2. A 3D dust sculpture for every page
     ========================================================= */
  const lorenz = (() => {
    const out = [];
    let x = 0.1, y = 0, z = 0;
    const dt = 0.004;
    for (let i = 0; i < 50000; i++) {
      const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - (8 / 3) * z;
      x += dx * dt; y += dy * dt; z += dz * dt;
      if (i > 500) out.push(x / 22, -(z - 25) / 22, y / 22);
    }
    return out;
  })();
  const SHAPES = {
    about: (o, i) => {            // bell-curve surface
      let x = (R() * 2 - 1) * 1.25, z = (R() * 2 - 1) * 1.25;
      if (R() < 0.75) { if (R() < 0.5) x = Math.round(x * 6) / 6; else z = Math.round(z * 6) / 6; }
      o[i] = x; o[i + 1] = 0.55 - 1.35 * Math.exp(-(x * x + z * z) * 2.2); o[i + 2] = z;
    },
    experience: (o, i) => {       // double helix
      const t = R(), s = R();
      if (s < 0.84) {
        const a = t * Math.PI * 7, sign = s < 0.42 ? 1 : -1;
        o[i] = Math.cos(a) * 0.6 * sign + gauss() * 0.008; o[i + 1] = (t - 0.5) * 2.4; o[i + 2] = Math.sin(a) * 0.6 * sign + gauss() * 0.008;
      } else {
        const tq = Math.round(t * 30) / 30, a = tq * Math.PI * 7, u = R() * 2 - 1;
        o[i] = Math.cos(a) * 0.6 * u; o[i + 1] = (tq - 0.5) * 2.4 + gauss() * 0.004; o[i + 2] = Math.sin(a) * 0.6 * u;
      }
    },
    toolkit: (o, i) => {          // trefoil knot
      const t = R() * Math.PI * 2, r = 2 + Math.cos(3 * t);
      o[i] = (r * Math.cos(2 * t)) / 2.7 + gauss() * 0.03; o[i + 1] = Math.sin(3 * t) / 2.7 + gauss() * 0.03; o[i + 2] = (r * Math.sin(2 * t)) / 2.7 + gauss() * 0.03;
    },
    contact: (o, i) => {          // ripple
      let r = Math.sqrt(R()) * 1.35;
      const a = R() * Math.PI * 2;
      if (R() < 0.6) r = Math.round(r * 9) / 9 + gauss() * 0.004;
      o[i] = r * Math.cos(a); o[i + 1] = 0.2 - (0.55 * Math.cos(r * 9)) / (1 + 2.2 * r); o[i + 2] = r * Math.sin(a);
    },
    lorenz: (o, i) => {
      const k = ((R() * (lorenz.length / 3)) | 0) * 3;
      o[i] = lorenz[k] + gauss() * 0.01; o[i + 1] = lorenz[k + 1] + gauss() * 0.01; o[i + 2] = lorenz[k + 2] + gauss() * 0.01;
    },
  };

  /* =========================================================
     3. GPU buffers
     ========================================================= */
  const rnd = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { rnd[i * 2] = R(); rnd[i * 2 + 1] = (R() - 0.5) * 2; }
  const rndBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rndBuf); gl.bufferData(gl.ARRAY_BUFFER, rnd, gl.STATIC_DRAW);
  let fromBuf = gl.createBuffer(), toBuf = gl.createBuffer();
  const vao = gl.createVertexArray();
  const bindLayouts = () => {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fromBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, toBuf);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE * 4, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, rndBuf);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
  };
  const upload = (buf, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); };
  // pulses
  const PULSE_MAX = 7 * 6 * 46;
  const pulseData = new Float32Array(PULSE_MAX * 3);
  const pulseBuf = gl.createBuffer(), pulseVao = gl.createVertexArray();
  gl.bindVertexArray(pulseVao); gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
  gl.bufferData(gl.ARRAY_BUFFER, pulseData, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);   // additive: overlapping dust adds up

  /* =========================================================
     4. Canvas + layout
     ========================================================= */
  const stage = document.getElementById("stage");
  let W = 1, H = 1, dpr = 1, booted = false;
  let nGraph = N;                                      // how many grains the graph itself currently uses
  let stageBox = { x: 0, y: 0, w: 0, h: 0 };
  const measureStage = () => {
    const r = stage.getBoundingClientRect();
    stageBox = { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const resize = () => {
    const vw = canvas.clientWidth || window.innerWidth, vh = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(vw * dpr)); H = Math.max(1, Math.round(vh * dpr));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    measureStage();
    if (!booted) return;
    if (mode === "page" && activePage) layoutPage(); else composeHome();
    upload(toBuf, pageL);
  };

  const sampleWord = (text, box) => {
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
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
    fs *= Math.min(1, (w * 0.98) / m.width, (h * 0.96) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
    setFont(fs);
    m = o.measureText(text);
    o.fillStyle = "#fff";
    o.fillText(text, 0, (h - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2 + m.actualBoundingBoxAscent);
    const data = o.getImageData(0, 0, w, h).data;
    const out = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3] > 128) out.push(x, y);
    return out;
  };

  /* ---- live demos: a slice of dust simulated here, with springs, and re-uploaded as it moves ---- */
  let activePage = null, demo = null;
  let dStart = 0, dCount = 0, dT = null, dB = null, dOff = null, dVel = null, dStage = null, dDirty = false, dLive = 0, demoGain = 0.3;
  const docBox = (el) => {
    let x = 0, y = 0;
    for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x * dpr, y: y * dpr, w: el.offsetWidth * dpr, h: el.offsetHeight * dpr };
  };
  const demoApi = {
    idx: new Int32Array(0), box: { x: 0, y: 0, w: 1, h: 1 }, dpr: 1, snap: true, busy: true, scroll: 0,
    set(i, x, y, b) {
      const nx = this.box.x + x, ny = this.box.y + y, j = i * 2;
      if (!this.snap) { dOff[j] += dT[j] - nx; dOff[j + 1] += dT[j + 1] - ny; }   // stay put, then spring over
      dT[j] = nx; dT[j + 1] = ny; dB[i] = b; dDirty = true;
    },
    nudge(i, dx, dy) { if (!this.snap) { dOff[i * 2] += dx; dOff[i * 2 + 1] += dy; dDirty = true; } },
    kick(i, vx, vy) { if (!this.snap) { dVel[i * 2] += vx; dVel[i * 2 + 1] += vy; dDirty = true; } },
    blast(x, y, power) { if (!this.snap) blast(this.box.x + x, this.box.y + y - this.scroll, power); },
  };
  const SPRING = 0.035, DAMP = 0.88;
  const writeDemo = (target) => {
    let live = 0;
    for (let j = 0; j < dCount; j++) {
      const k = j * 2;
      let ox = dOff[k], oy = dOff[k + 1], vx = dVel[k], vy = dVel[k + 1];
      if (ox !== 0 || oy !== 0 || vx !== 0 || vy !== 0) {
        vx = (vx - ox * SPRING) * DAMP; vy = (vy - oy * SPRING) * DAMP;
        ox += vx; oy += vy;
        if (Math.abs(ox) + Math.abs(oy) + Math.abs(vx) + Math.abs(vy) < 0.05) ox = oy = vx = vy = 0; else live++;
        dOff[k] = ox; dOff[k + 1] = oy; dVel[k] = vx; dVel[k + 1] = vy;
      }
      const o = j * STRIDE;
      target[o] = dT[k] + ox; target[o + 1] = dT[k + 1] + oy; target[o + 3] = dB[j] * demoGain;
    }
    dLive = live; dDirty = false;
  };

  const pageL = new Float32Array(N * STRIDE);
  let ranges = [[0, N]];                              // contiguous slices of the buffer, for even thinning on slow devices
  const layoutPage = () => {
    const slot = activePage.querySelector(".title-slot");
    const r = slot.getBoundingClientRect();
    const ox = r.left * dpr, oy = (r.top + window.scrollY) * dpr;
    const wordPts = sampleWord(activePage.dataset.title, r);
    const M = wordPts.length / 2;
    const id = activePage.dataset.page;
    const shape = demo ? null : SHAPES[id];
    const narrow = W / dpr < 820;
    const nW = M ? Math.floor(N * (demo ? 0.32 : 0.56)) : 0;
    const n2 = demo ? Math.min(150000, Math.floor(N * 0.45)) : shape ? Math.floor(N * 0.34) : 0;
    const nA = Math.min(N - nW - n2, Math.floor(N * (demo ? 0.22 : 0.1)));
    const L = pageL;
    // title word: brightness chosen so the letters look equally dusty at any size
    const wordB = Math.min(0.9, (0.3 * M) / Math.max(1, nW));
    for (let i = 0; i < nW; i++) {
      const o = i * STRIDE, k = ((R() * M) | 0) * 2;
      L[o] = ox + wordPts[k] + R(); L[o + 1] = oy + wordPts[k + 1] + R(); L[o + 2] = 0;
      L[o + 3] = wordB * (0.5 + R()); L[o + 4] = 1; L[o + 5] = -1;
    }
    if (shape) {
      const sb = 0.55 * Math.sqrt(31000 / n2) * (narrow ? 0.6 : 1);
      for (let i = nW; i < nW + n2; i++) {
        const o = i * STRIDE;
        shape(L, o);
        L[o + 3] = (0.2 + R() * 0.4) * sb; L[o + 4] = 2; L[o + 5] = -1;
      }
    }
    for (let i = nW + n2; i < N; i++) {
      const o = i * STRIDE, on = i < nW + n2 + nA;
      L[o] = R() * W; L[o + 1] = R() * H; L[o + 2] = 0;
      L[o + 3] = on ? ambientB() * 0.8 : 0; L[o + 4] = 3; L[o + 5] = -1;   // leftover grains are parked, invisible
    }
    ranges = [[0, nW], [nW, n2], [nW + n2, nA]];
    if (demo) {
      dStart = nW; dCount = n2;
      dT = new Float32Array(n2 * 2); dB = new Float32Array(n2); dOff = new Float32Array(n2 * 2); dVel = new Float32Array(n2 * 2);
      demoGain = 0.55 * Math.sqrt(57000 / n2) * 0.85;
      demoApi.idx = Int32Array.from({ length: n2 }, (_, i) => i);
      demoApi.box = docBox(activePage.querySelector("[data-stage]"));
      demoApi.dpr = dpr; demoApi.snap = true;
      dStage = L.subarray(nW * STRIDE, (nW + n2) * STRIDE);
      for (let j = 0; j < n2; j++) { dStage[j * STRIDE + 2] = 0; dStage[j * STRIDE + 4] = 4; dStage[j * STRIDE + 5] = -1; }
      demo.layout();
      writeDemo(dStage);
    }
  };

  // Home and Projects levels: part of the dust is the graph, the rest is a fine field over the whole screen.
  const ambientB = () => { const r = R(); return 0.035 + 0.26 * r * r * r; };   // mostly faint, a few bright specks
  const composeHome = () => {
    const L = pageL;
    L.set(G.L);                                        // any slice of a graph layout is an even sample of it
    const nG = Math.floor(N * 0.36), nA = Math.floor(N * 0.34);
    for (let i = nG; i < N; i++) {
      const o = i * STRIDE;
      L[o] = R() * W; L[o + 1] = R() * H; L[o + 2] = 0;
      L[o + 3] = i < nG + nA ? ambientB() : 0;         // leftover grains are parked, invisible
      L[o + 4] = 3; L[o + 5] = -1;
    }
    nGraph = nG;
    ranges = [[0, nG], [nG, nA]];
  };

  /* =========================================================
     5. Transitions: the old layout (frozen camera) morphs into the new one
     ========================================================= */
  let mode = "home";
  let tStart = -1e9;
  const DUR = reduceMotion ? 1 : 1900;
  const cam = { rot: [0.6, -0.25], zoom: [0, 0, 0, 0], zm: [1, 1], scroll: 0 };      // live camera, updated every frame
  const camF = { rot: [0.6, -0.25], zoom: [0, 0, 0, 0], zm: [1, 1], scroll: 0 };     // camera frozen when the last layout was left
  const begin = (m, layout) => {
    camF.rot = cam.rot.slice(); camF.zoom = cam.zoom.slice(); camF.zm = cam.zm.slice(); camF.scroll = cam.scroll;
    [fromBuf, toBuf] = [toBuf, fromBuf];
    upload(toBuf, layout);
    bindLayouts();
    mode = m;
    tStart = performance.now();
  };

  /* =========================================================
     6. Interaction: tilt, drag, hover, zoom, shockwaves
     ========================================================= */
  let rotY = 0.6, rotX = -0.25;
  const baseSpin = reduceMotion ? 0 : 0.0025;
  let spin = baseSpin, targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  const mouse = { x: -9999, y: -9999, cx: -100, cy: -100, active: false };
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let hovered = -1, labelHover = -1;
  const waves = [];
  const ZIN = Math.log(13), ZOUT = -1.5;
  let zl = 0, zlT = 0, zRate = 0.16, focus = -1, lastWheel = 0;
  let pending = null, entering = false, skipDive = false, outAmt = 0;

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
  const getPulses = (g) => g.pulses || (g.pulses = Array.from({ length: reduceMotion ? 0 : Math.min(7, g.edges.length) }, () => {
    const e = g.edges[(R() * g.edges.length) | 0];
    return { a: e[0], b: e[1], p: R(), s: 0.006 + R() * 0.008 };
  }));

  // Scroll = zoom
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
    if (pending || entering || performance.now() - tStart < 1300) return;   // also swallows trackpad momentum after a level change
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

  const cursorEl = document.querySelector(".cursor");
  const dotEl = document.querySelector(".cursor-dot");
  const progressEl = document.querySelector(".progress");
  let ringX = -100, ringY = -100;
  if (finePointer && !reduceMotion) {
    document.documentElement.classList.add("fx-cursor");
    window.addEventListener("pointerdown", () => cursorEl.classList.add("down"));
    window.addEventListener("pointerup", () => cursorEl.classList.remove("down"));
    document.addEventListener("pointerover", (e) => cursorEl.classList.toggle("link", !!e.target.closest("a, button")));
  }

  /* =========================================================
     7. Render loop
     ========================================================= */
  let lastScrollPx = 0, lastNow = 0, emaDt = 16, slowFrames = 0, lastZv = 0, smear = 0, quality = 1;
  const zmEl = document.querySelector(".zoom-meter"), zmFill = document.querySelector(".zm-fill"), zmLabel = document.querySelector(".zm-label");
  const pagesEl = document.getElementById("pages");
  const waveU = new Float32Array(16);

  const frame = (now) => {
    // adaptive quality: draw a thinner, brighter sample of the dust if the device can't keep up
    const dtMs = lastNow ? now - lastNow : 16;
    lastNow = now;
    if (dtMs < 200) emaDt += (dtMs - emaDt) * 0.05;
    if (emaDt > 24 && quality > 0.3 && ++slowFrames > 80) { quality *= 0.7; slowFrames = 0; emaDt = 16; }
    else if (emaDt <= 24) slowFrames = 0;

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
    const nodes = G.nodes, nodeScr = G.nodeScr, hoverAmt = G.hoverAmt, PN = G.pageNodes;

    if (!dragging) spin += (baseSpin * (1 - zIn) - spin) * 0.02;
    rotY += spin;
    tiltX += (targetTiltX - tiltX) * 0.05;
    tiltY += (targetTiltY - tiltY) * 0.05;

    // ----- graph camera (must match the shader exactly: labels and clicks use these numbers) -----
    const ry = rotY + tiltY, rx = rotX + tiltX;
    const cyA = Math.cos(ry), syA = Math.sin(ry), cxA = Math.cos(rx), sxA = Math.sin(rx);
    const size = Math.min(stageBox.w, stageBox.h) || Math.min(W, H) / dpr;
    const scale = size * dpr * 0.37;
    const gcx = (stageBox.x + stageBox.w / 2) * dpr, gcy = (stageBox.y + stageBox.h / 2) * dpr;
    const tmp = [0, 0, 0, 0];
    const project = (x, y, z) => {
      const x1 = x * cyA + z * syA, z1 = -x * syA + z * cyA;
      const y1 = y * cxA - z1 * sxA, z2 = y * sxA + z1 * cxA;
      const f = 3.2 / (3.2 + z2);
      tmp[0] = gcx + x1 * f * scale; tmp[1] = gcy + y1 * f * scale; tmp[2] = z2; tmp[3] = f;
    };

    let fx = gcx, fy = gcy, pvx = gcx, pvy = gcy;
    if (inHome) {
      nodes.forEach((n, ni) => {
        project(n.p[0], n.p[1], n.p[2]);
        const s = nodeScr[ni];
        s.x = tmp[0]; s.y = tmp[1]; s.z = tmp[2]; s.r = n.r * tmp[3] * scale;
      });
      if (focus >= 0 && zl > 0 && PN[focus] != null) {
        const f = nodeScr[PN[focus]], sm = zIn * zIn * (3 - 2 * zIn);
        fx = f.x; fy = f.y;
        pvx = fx + (gcx - fx) * sm; pvy = fy + (gcy - fy) * sm;
      }
      if (Zm !== 1) for (const sc of nodeScr) { sc.x = pvx + (sc.x - fx) * Zm; sc.y = pvy + (sc.y - fy) * Zm; sc.r *= Zm; }
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
      cam.rot[0] = ry; cam.rot[1] = rx;
      cam.zoom[0] = fx; cam.zoom[1] = fy; cam.zoom[2] = pvx; cam.zoom[3] = pvy;
      cam.zm[0] = Zm; cam.zm[1] = 1 + 0.3 * Math.max(0, zl);
    } else {
      hovered = -1;
    }
    stage.classList.toggle("on-node", hovered >= 0);
    let hovNode = -1, hovAmt = 0;
    for (let ni = 0; ni < nodes.length; ni++) {
      const want = hovered >= 0 && PN[hovered] === ni ? 1 : 0;
      hoverAmt[ni] += (want - hoverAmt[ni]) * 0.12;
      if (hoverAmt[ni] > hovAmt) { hovAmt = hoverAmt[ni]; hovNode = ni; }
    }

    // ----- labels -----
    if (inHome) {
      const labelsShow = elapsed > DUR * 0.6;
      PN.forEach((ni, pi) => {
        const s = nodeScr[ni], el = labels[pi];
        if (!el) return;
        const lx = s.x / dpr - stageBox.x, ly = s.y / dpr - stageBox.y;
        const off = s.r / dpr + 10, lw = el.offsetWidth;
        const left = lx + off + lw > stageBox.w - 4 ? lx - off - lw : lx + off;
        const depth = Math.min(1, Math.max(0, (0.7 - s.z) / 1.4));
        el.style.transform = `translate(${left.toFixed(1)}px, ${(ly - 13).toFixed(1)}px)`;
        const zFade = (focus === pi ? 1 : 1 - zIn) * Math.min(1, Math.max(0, 1 + zl));
        el.style.opacity = labelsShow && el.isConnected ? ((0.3 + 0.7 * depth) * zFade).toFixed(2) : "0";
        el.style.zIndex = String(Math.round(depth * 10));
        el.classList.toggle("hot", hovered === pi);
      });
    }

    // ----- cursor, progress, zoom meter -----
    if (cursorEl && finePointer) {
      ringX += (mouse.cx - ringX) * 0.2; ringY += (mouse.cy - ringY) * 0.2;
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
    const zv = inHome ? (zl >= 0 ? zl / ZIN : -zl / ZOUT) : -outAmt;
    if (Math.abs(zv - lastZv) > 0.004) {
      lastZv = zv;
      zmEl.classList.toggle("on", Math.abs(zv) > 0.03);
      zmFill.style.transform = `scaleY(${Math.min(1, Math.abs(zv)).toFixed(3)})`;
      zmLabel.textContent = zv > 0 ? "zoom in" : "zoom out";
      pagesEl.style.transform = !inHome && outAmt > 0 ? `scale(${(1 - 0.07 * outAmt).toFixed(4)})` : "";
      pagesEl.style.opacity = !inHome && outAmt > 0 ? (1 - 0.6 * outAmt).toFixed(3) : "";
    }

    // ----- scroll + sculpture camera -----
    const wide = W / dpr > 820;
    const scrollPx = window.scrollY * dpr;
    const dScroll = scrollPx - lastScrollPx;
    lastScrollPx = scrollPx;
    smear = Math.abs(dScroll) < 400 * dpr && !transitioning ? smear * 0.86 + dScroll : smear * 0.86;
    if (!inHome) cam.scroll = scrollPx;

    // ----- live demo -----
    if (demo && !inHome) {
      demoApi.snap = transitioning || reduceMotion;
      demoApi.busy = transitioning;
      demoApi.scroll = scrollPx;
      demo.tick(now);
      if (dDirty || dLive) {
        writeDemo(dStage);
        gl.bindBuffer(gl.ARRAY_BUFFER, toBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, dStart * STRIDE * 4, dStage);
      }
    }

    // ----- shockwaves -----
    for (let w = waves.length - 1; w >= 0; w--) if (now - waves[w].t0 > 1100) waves.splice(w, 1);
    waveU.fill(0);
    waves.forEach((w, i) => {
      const age = (now - w.t0) / 1100;
      waveU[i * 4] = w.x; waveU[i * 4 + 1] = w.y;
      waveU[i * 4 + 2] = age * Math.hypot(W, H) * 0.75;
      waveU[i * 4 + 3] = w.power * (1 - age) * 30 * dpr;
    });

    // ----- draw the dust -----
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uT, now * 0.001);
    gl.uniform1f(U.uP, Math.min(1, elapsed / DUR));
    gl.uniform1f(U.uGainG, 0.29 * Math.sqrt(90000 / nGraph) * (dpr > 1.5 ? 1 : 1.5) + 0.015);
    gl.uniform1f(U.uPt, 0.7);
    gl.uniform1f(U.uSmear, smear);
    gl.uniform1f(U.uQ, 1 / Math.pow(quality, 0.8));
    gl.uniform3f(U.uGeo, gcx, gcy, scale);
    gl.uniform2f(U.uRotT, cam.rot[0], cam.rot[1]);
    gl.uniform2f(U.uRotF, camF.rot[0], camF.rot[1]);
    gl.uniform4fv(U.uZoomT, cam.zoom);
    gl.uniform4fv(U.uZoomF, camF.zoom);
    gl.uniform2fv(U.uZmT, cam.zm);
    gl.uniform2fv(U.uZmF, camF.zm);
    gl.uniform1f(U.uScrollT, scrollPx);
    gl.uniform1f(U.uScrollF, camF.scroll);
    gl.uniform4f(U.uSc, W * (wide ? 0.74 : 0.5), H * (wide ? 0.6 : 0.64), Math.min(W, H) * (wide ? 0.36 : 0.4), 0);
    gl.uniform2f(U.uScRot, now * 0.00024 + tiltY * 1.4, 0.38 + tiltX * 0.9);
    const hs = hovNode >= 0 ? nodeScr[hovNode] : null;
    gl.uniform4f(U.uHover, inHome ? hovNode : -9, hs ? hs.x : 0, hs ? hs.y : 0, inHome ? hovAmt : 0);
    gl.uniform3f(U.uMouse, mouse.active && !reduceMotion ? mouse.x : -1e6, mouse.y, Math.min(W, H) * 0.11);
    gl.uniform4fv(U.uWave, waveU);
    for (const [st, ct] of ranges) if (ct > 0) gl.drawArrays(gl.POINTS, st, Math.max(1, Math.floor(ct * quality)));

    // ----- pulses running along the graph's edges -----
    if (inHome && elapsed > DUR * 0.8) {
      const fade = Math.min(1, (elapsed - DUR * 0.8) / 600);
      let n = 0;
      for (const pl of getPulses(G)) {
        pl.p += pl.s;
        if (pl.p >= 1) {
          const opts = G.adj[pl.b].filter((q) => q !== pl.a);
          const next = opts.length ? opts[(R() * opts.length) | 0] : pl.a;
          pl.a = pl.b; pl.b = next; pl.p = 0;
          pl.s = 0.006 + R() * 0.008;
        }
        const A = nodes[pl.a].p, B = nodes[pl.b].p;
        for (let tr = 0; tr < 6; tr++) {
          const p = pl.p - tr * 0.025;
          if (p < 0) break;
          project(A[0] + (B[0] - A[0]) * p, A[1] + (B[1] - A[1]) * p, A[2] + (B[2] - A[2]) * p);
          const rad = (3.2 - tr * 0.35) * dpr * tmp[3] * Math.sqrt(Zm);
          const qx = pvx + (tmp[0] - fx) * Zm, qy = pvy + (tmp[1] - fy) * Zm;
          const al = 0.5 * fade * (1 - tr / 6);
          for (let j = 0; j < 46 && n < PULSE_MAX; j++, n++) {
            pulseData[n * 3] = qx + (R() + R() - 1) * rad;
            pulseData[n * 3 + 1] = qy + (R() + R() - 1) * rad;
            pulseData[n * 3 + 2] = al;
          }
        }
      }
      if (n) {
        gl.useProgram(prog2);
        gl.bindVertexArray(pulseVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pulseData.subarray(0, n * 3));
        gl.uniform2f(U2.uRes, W, H);
        gl.uniform1f(U2.uDpr, dpr);
        gl.drawArrays(gl.POINTS, 0, n);
      }
    }
    requestAnimationFrame(frame);
  };

  /* =========================================================
     8. Page-entry effects
     ========================================================= */
  const GLYPHS = "ΣΔπλ∫∂01<>/#*+=";
  const scramble = (el, frames = 28) => {
    if (reduceMotion || el._scrambling) return;
    const final = el.dataset.final || (el.dataset.final = el.textContent);
    el._scrambling = true;
    let f = 0;
    const tick = () => {
      el.textContent = final.split("").map((ch, i) => (ch === " " ? " " : f / frames > i / final.length ? ch : GLYPHS[(R() * GLYPHS.length) | 0])).join("");
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
      let s = (target * (1 - Math.pow(1 - p, 4))).toFixed(decimals);
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
     9. Router
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
    begin("page", pageL);
    cam.scroll = 0;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (!activePage) return;
      activePage.classList.add("shown");
      pageFx(activePage);
    }, reduceMotion ? 0 : 950);
    barLinks.forEach((a) => a.classList.toggle("active", a.dataset.link === id.split("/")[0]));
    document.title = `${activePage.dataset.title} — Dhruv Khemka`;
  };

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
    composeHome();
    begin("home", pageL);                             // freezes the outgoing camera before the zoom state is reset
    lastWheel = 0; zlT = 0; zRate = 0.05;
    const from = g.pages.findIndex((p) => p.id === prev);
    if (reduceMotion) { zl = 0; focus = -1; }
    else if (from >= 0) { focus = from; zl = ZIN; zRate = 0.045; }
    else if (g.parent === prev && wasGraph) { focus = -1; zl = Math.log(0.14); }
    else { focus = -1; zl = id === "" ? 0 : Math.log(0.3); }
    document.title = id ? `${g.heading} — Dhruv Khemka` : "Dhruv Khemka";
  };

  const route = () => {
    let id = location.hash.replace(/^#\/?/, "");
    if (!GRAPHS[id] && !sections[id]) id = "";
    if (id === currentId && !pending) { entering = false; return; }
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

  // Big bang: every grain starts at one bright point, then expands into the graph
  resize();
  {
    const bx = (stageBox.x + stageBox.w / 2) * dpr, by = (stageBox.y + stageBox.h / 2) * dpr;
    const L = pageL, b = Math.min(0.9, 60000 / N);
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      L[o] = bx + (R() - 0.5) * 6 * dpr; L[o + 1] = by + (R() - 0.5) * 6 * dpr; L[o + 2] = 0; L[o + 3] = b; L[o + 4] = 4; L[o + 5] = -1;
    }
    upload(toBuf, L);
    upload(fromBuf, L);
  }
  setGraph(G);
  composeHome();
  begin("home", pageL);
  booted = true;
  requestAnimationFrame(frame);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    measureStage();
    route();
  });

  /* =========================================================
     10. Ticker, wordmark, cards, magnetic links
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

  scramble(wordEl, 40);
  wordEl.addEventListener("pointerenter", () => scramble(wordEl, 22));

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
  window.__engine = `webgl · ${N.toLocaleString("en-US")} grains`;
})();
