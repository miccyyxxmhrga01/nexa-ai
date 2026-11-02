/* Nexa's orb: a hologram of green light. A glowing core (a tunnel of rings, like an eye) inside
   dashed data rings and dial ticks, a wide tilted band of fine lines, big outer rings carrying
   circuit traces, rays and long threads across it, out-of-focus bokeh and sparks. It turns and
   ripples like water, takes the shape of your voice while listening and of hers while speaking,
   and builds itself from the core outward when a conversation opens. In the voice session a
   bloom pass makes the threads glow. WebGL and no libraries, so it works offline; app.js uses
   the flat orb instead when WebGL isn't available. */

const ORB_PALETTES = {
  // On dark backgrounds (the voice session, the dark page): light that adds up toward white.
  dark: { deep: [0.04, 0.5, 0.26], main: [0.33, 0.95, 0.64], hot: [0.88, 1.0, 0.93], cyan: [0.36, 0.96, 0.86] },
  // On the light page: deeper greens, drawn over the page instead of added to it.
  light: { deep: [0.42, 0.8, 0.6], main: [0.05, 0.56, 0.33], hot: [0.02, 0.38, 0.2], cyan: [0.03, 0.52, 0.48] },
};

const ORB_GLSL = {
  quad: "attribute vec2 a; varying vec2 vUv; void main() { vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }",

  // The voice session's space: deep green, far-off blurred lights, haze around the core, a lens streak.
  backdrop: `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uUnit;
uniform float uTime;
uniform vec4 uMood;  // voice level, listening, thinking, speaking
uniform float uIntro;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uUnit;
  float d = length(p);
  float energy = 0.6 + 0.25 * uMood.y + 0.35 * uMood.z + (0.3 + 0.7 * uMood.x) * uMood.w;
  vec3 col = mix(vec3(0.003, 0.02, 0.012), vec3(0.012, 0.075, 0.045), exp(-d * 0.35));
  col = mix(col, vec3(0.03, 0.2, 0.11), exp(-d * d * 0.16) * 0.5);
  float n = fbm(p * 0.35 + vec2(uTime * 0.01, -uTime * 0.006));
  col += vec3(0.04, 0.22, 0.12) * smoothstep(0.55, 0.85, n) * 0.35;
  col += vec3(0.12, 0.9, 0.5) * exp(-d * d * 0.9) * (0.05 + 0.06 * energy) * uIntro;
  col += vec3(0.8, 1.0, 0.88) * exp(-d * d * 18.0) * (0.1 + 0.15 * energy + 0.35 * uMood.x * uMood.w) * uIntro;
  float streak = exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 0.6);
  col += vec3(0.3, 1.0, 0.65) * streak * (0.04 + 0.06 * energy) * uIntro;
  vec2 cell = floor(gl_FragCoord.xy / 3.0);
  float h = hash(cell);
  if (h > 0.997) {
    vec2 f = fract(gl_FragCoord.xy / 3.0) - 0.5;
    col += vec3(0.8, 1.0, 0.9) * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 60.0)) * exp(-dot(f, f) * 14.0) * 0.35 * smoothstep(1.6, 3.0, d);
  }
  vec2 s = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - dot(s, s) * 1.1;
  gl_FragColor = vec4(col, 1.0);
}`,

  // Threads are soft quads: a thin bright core with a wide glow around it.
  lineVert: `
attribute vec2 aPos;
attribute vec2 aSide;
attribute vec4 aColor;
uniform vec2 uRes;
varying float vAcross;
varying float vHW;
varying vec4 vColor;
void main() {
  vAcross = aSide.x;
  vHW = aSide.y;
  vColor = aColor;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`,
  lineFrag: `
precision mediump float;
uniform float uGlow;
varying float vAcross;
varying float vHW;
varying vec4 vColor;
void main() {
  float x = abs(vAcross) * vHW;
  float cw = max(vHW * 0.24, 0.6);
  float core = exp(-(x * x) / (cw * cw));
  float g = x / (vHW * 0.45);
  float a = vColor.a * (core + exp(-g * g) * uGlow);
  gl_FragColor = vec4(vColor.rgb * a, a);
}`,

  // Dots: sparks (kind 0), bokeh discs with a brighter rim (1), little square nodes (2).
  dotVert: `
attribute vec2 aPos;
attribute vec2 aSide;
attribute vec4 aColor;
uniform vec2 uRes;
varying float vKind;
varying vec4 vColor;
void main() {
  vKind = aSide.y;
  vColor = aColor;
  gl_PointSize = aSide.x;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`,
  dotFrag: `
precision mediump float;
varying float vKind;
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a;
  if (vKind < 0.5) {
    a = exp(-d * d * 6.0) + (1.0 - smoothstep(0.0, 0.3, d)) * 0.8;
  } else if (vKind < 1.5) {
    float disc = 1.0 - smoothstep(0.82, 1.0, d);
    a = disc * 0.55 + smoothstep(0.55, 0.95, d) * disc * 0.45;
  } else {
    vec2 q = abs(c) * 2.0;
    a = 1.0 - smoothstep(0.5, 0.7, max(q.x, q.y));
    a += exp(-d * d * 4.0) * 0.4;
  }
  a *= vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`,

  // Bloom: keep the bright parts, blur them, add them back over the scene.
  bright: `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uCut;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  gl_FragColor = vec4(max(c - uCut, 0.0) / (1.0 - uCut), 1.0);
}`,
  blur: `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
  c += (texture2D(uTex, vUv + uStep * 1.3846154).rgb + texture2D(uTex, vUv - uStep * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(uTex, vUv + uStep * 3.2307692).rgb + texture2D(uTex, vUv - uStep * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`,
  composite: `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uAmount;
void main() {
  gl_FragColor = vec4(texture2D(uScene, vUv).rgb + texture2D(uBloom, vUv).rgb * uAmount, 1.0);
}`,
};

class Orb3D {
  /** True if this PC can draw the 3D orb (WebGL works and the shaders compile). */
  static probe() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return false;
      Orb3D.compile(gl);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch (e) {
      Orb3D.problem = String(e.message || e).slice(0, 300); // reported to the log by app.js
      return false;
    }
  }

  static compile(gl) {
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader failed");
      return s;
    };
    const link = (vert, frag) => {
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vert));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
      return program;
    };
    const G = ORB_GLSL;
    return {
      backdrop: link(G.quad, G.backdrop),
      line: link(G.lineVert, G.lineFrag),
      dot: link(G.dotVert, G.dotFrag),
      bright: link(G.quad, G.bright),
      blur: link(G.quad, G.blur),
      composite: link(G.quad, G.composite),
    };
  }

  /**
   * compact: the small orb on the welcome screen (drawn over the page, no background).
   * anchor: the element the orb sits on (the canvas itself if not given).
   * world: the full-screen voice-session view (deep space behind the orb, with bloom).
   */
  constructor(canvas, { compact = false, anchor = null, world = false } = {}) {
    this.canvas = canvas;
    this.compact = compact;
    this.anchor = anchor || canvas;
    this.world = world;
    this.mode = "idle";
    this.level = 0;
    this.input = 0;
    this.t = 0;
    this.listenAmt = 0;
    this.thinkAmt = 0;
    this.speakAmt = 0;
    this.intro = 1;
    this.queued = []; // ripples asked for by pulse()
    this.waveSource = null; // () => Float32Array of recent audio samples, or null
    this.running = false;
    this.quality = 1; // lowered automatically if the PC can't keep up
    this.slowFrames = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.waveBins = new Float32Array(64);
    this.wavePeak = 0.05;
    this.waveClock = 0;
    this.roll = 0;
    this.prevLevel = 0;
    this.sinceRipple = 0;
    this.darkPage = matchMedia("(prefers-color-scheme: dark)");
    this.frame = this.frame.bind(this);
    this.initGL();
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this.initGL(); this.resize(); });
    new ResizeObserver(() => this.resize()).observe(canvas);
    if (this.anchor !== canvas) new ResizeObserver(() => this.place()).observe(this.anchor);
    this.anchor.addEventListener("pointermove", (event) => {
      if (REDUCED || event.pointerType === "touch") return;
      const rect = this.anchor.getBoundingClientRect();
      this.pointer.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 0.16;
      this.pointer.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 0.12;
    });
    this.anchor.addEventListener("pointerleave", () => { this.pointer.tx = this.pointer.ty = 0; });
  }

  initGL() {
    const gl = this.gl = this.canvas.getContext("webgl", { alpha: !this.world, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("WebGL unavailable");
    const progs = this.progs = Orb3D.compile(gl);
    const uniforms = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    this.loc = {
      quad: Object.fromEntries(["backdrop", "bright", "blur", "composite"].map((k) => [k, gl.getAttribLocation(progs[k], "a")])),
      line: ["aPos", "aSide", "aColor"].map((n) => gl.getAttribLocation(progs.line, n)),
      dot: ["aPos", "aSide", "aColor"].map((n) => gl.getAttribLocation(progs.dot, n)),
    };
    this.u = {
      backdrop: uniforms(progs.backdrop, ["uRes", "uCenter", "uUnit", "uTime", "uMood", "uIntro"]),
      line: uniforms(progs.line, ["uRes", "uGlow"]),
      dot: uniforms(progs.dot, ["uRes"]),
      bright: uniforms(progs.bright, ["uTex", "uCut"]),
      blur: uniforms(progs.blur, ["uTex", "uStep"]),
      composite: uniforms(progs.composite, ["uScene", "uBloom", "uAmount"]),
    };
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    this.lineBuf = gl.createBuffer();
    this.dotBuf = gl.createBuffer();
    this.indexBuf = gl.createBuffer();
    this.build(!this.compact);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geo.index, gl.STATIC_DRAW);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPoint = range && range[1] ? range[1] : 64;
    this.targets = null;
  }

  random(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /**
   * The hologram's parts. Ring points are kept as (ring, angle, radius factor) so rings can spin,
   * ripple and grow in; threads are fixed 3D points. Everything is projected again every frame.
   * Groups: 0 core, 1 rings, 2 circuit traces, 3 rays, 4 long threads, 5 ripples, 6 voice ring.
   */
  build(dense) {
    const TAU = Math.PI * 2;
    const rand = this.random(20261019);
    const R = (a, b) => a + (b - a) * rand();
    const norm = (x, y, z) => {
      const l = Math.hypot(x, y, z);
      return [x / l, y / l, z / l];
    };
    const rings = [];
    const ring = (r, n, speed, extra) => {
      const nn = norm(n[0], n[1], n[2]);
      const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(ref[1] * nn[2] - ref[2] * nn[1], ref[2] * nn[0] - ref[0] * nn[2], ref[0] * nn[1] - ref[1] * nn[0]);
      const v = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
      rings.push(Object.assign({ r, base: r, u, v, c: [0, 0, 0], speed, spin: R(0, TAU), ph: R(0, TAU), alpha: 1, wob: 1, reveal: 1 }, extra || {}));
      return rings.length - 1;
    };
    const pts = [];
    const polys = [];
    const poly = (list, o) => {
      if (list.length < 2) return;
      polys.push({
        start: pts.length, count: list.length, width: o.width, m: o.m, alpha: o.alpha, group: o.group,
        k: list[0][0] === 0 ? list[0][1] : -1, id: polys.length, pp: R(-1.5, 1), speed: R(0.7, 1.4),
      });
      for (const p of list) pts.push(p);
    };
    const arc = (k, t0, t1, rf, bright, step = 0) => {
      // About one point every 6 pixels: small rings need far fewer points than big ones.
      const st = step || Math.min(0.35, Math.max(0.03, 0.055 / (rings[k].base * rf)));
      const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / st) + 1);
      const out = [];
      for (let i = 0; i < n; i++) out.push([0, k, t0 + ((t1 - t0) * i) / (n - 1), rf, bright, i / (n - 1)]);
      return out;
    };
    const dashed = (k, rf, onMin, onMax, offMin, offMax, o) => {
      let th = R(0, 0.5);
      while (th < TAU) {
        const on = R(onMin, onMax);
        poly(arc(k, th, Math.min(th + on, TAU), rf, R(0.6, 1)), o);
        th += on + R(offMin, offMax);
      }
    };
    const ticks = (k, count, len, o) => {
      for (let i = 0; i < count; i++) {
        const th = (i / count) * TAU;
        const l = i % 6 === 0 ? len * 2.2 : len;
        poly([[0, k, th, 1, 1, 0], [0, k, th, 1 + l, 0.5, 1]], o);
      }
    };
    const band = (k, lines, gap, o) => {
      for (let j = 0; j < lines; j++) {
        const rf = 1 + (j - (lines - 1) / 2) * gap;
        let th = R(0, TAU);
        const arcs = 2 + Math.floor(rand() * 3);
        for (let a = 0; a < arcs; a++) {
          const len = R(0.6, 2.0);
          poly(arc(k, th, th + len, rf, R(0.5, 1)), o);
          th += len + R(0.15, 0.9);
        }
      }
    };
    const nodes = [];
    const trace = (k, o) => {
      let th = R(0, TAU);
      let rf = rand() < 0.6 ? R(0.84, 0.96) : R(1.04, 1.14);
      const list = [[0, k, th, rf, 1, 0]];
      nodes.push([k, th, rf]);
      const steps = 3 + Math.floor(rand() * 5);
      for (let s = 0; s < steps; s++) {
        if (s % 2 === 0) {
          const dth = (rand() < 0.5 ? -1 : 1) * R(0.04, 0.16);
          const n = Math.max(1, Math.ceil(Math.abs(dth) / 0.03));
          for (let i = 1; i <= n; i++) list.push([0, k, th + (dth * i) / n, rf, 1, 0]);
          th += dth;
        } else {
          rf += (rand() < 0.5 ? -1 : 1) * R(0.02, 0.05);
          list.push([0, k, th, rf, 1, 0]);
        }
      }
      list.forEach((p, i) => { p[5] = i / (list.length - 1); });
      poly(list, o);
      nodes.push([k, th, rf]);
    };

    // The core: a tunnel of rings receding into the distance, like an eye.
    const coreN = norm(0.06, 0.1, 1);
    for (let i = 0; i < 7; i++) {
      const k = ring(0.165 * (1 - i * 0.1), coreN, (i % 2 ? -1 : 1) * (0.5 + i * 0.15),
        { core: true, wob: 0.4, c: [-coreN[0] * 0.05 * i, -coreN[1] * 0.05 * i, -coreN[2] * 0.05 * i] });
      const o = { width: i === 0 ? 2.4 : 1.5, m: 1, alpha: 0.95 - i * 0.08, group: 0 };
      if (i % 3 === 1) dashed(k, 1, 0.3, 0.9, 0.08, 0.25, o);
      else poly(arc(k, 0, TAU, 1, 1), o);
    }
    // Dials and data rings around it.
    const dialK = ring(0.3, coreN, 0.12);
    ticks(dialK, dense ? 90 : 60, 0.035, { width: 0.9, m: 0.85, alpha: 0.55, group: 1 });
    poly(arc(dialK, 0, TAU, 0.97, 0.7), { width: 0.9, m: 0.6, alpha: 0.4, group: 1 });
    const k44 = ring(0.44, coreN, -0.09);
    dashed(k44, 1, 0.1, 0.6, 0.04, 0.2, { width: 1.3, m: 0.9, alpha: 0.6, group: 1 });
    const k58 = ring(0.58, coreN, 0.05);
    poly(arc(k58, 0, TAU, 1, 0.8), { width: 0.8, m: 0.55, alpha: 0.35, group: 1 });
    const k76 = ring(0.76, [0.1, 0.18, 1], 0.06);
    band(k76, 5, 0.012, { width: 0.9, m: 0.8, alpha: 0.32, group: 1 });
    // The wide tilted band of fine parallel lines, and a second tilted ring with ticks.
    const bandK = ring(1.08, [0.28, 1, 0.62], 0.07);
    band(bandK, dense ? 11 : 7, 0.016, { width: 0.95, m: 0.85, alpha: 0.3, group: 1 });
    const tiltK = ring(1.3, [-0.7, 0.45, 0.6], -0.05);
    dashed(tiltK, 1, 0.05, 0.4, 0.03, 0.15, { width: 1.1, m: 0.75, alpha: 0.45, group: 1 });
    ticks(tiltK, dense ? 60 : 40, 0.03, { width: 0.8, m: 0.6, alpha: 0.35, group: 1 });
    // The big outer rings, nearly facing you, carrying circuit traces.
    const outerN = [0.08, -0.14, 1];
    const outerK = ring(1.62, outerN, 0.025);
    dashed(outerK, 1, 0.8, 2.2, 0.05, 0.3, { width: 1.4, m: 0.9, alpha: 0.6, group: 1 });
    dashed(outerK, 1.018, 0.3, 1.5, 0.1, 0.5, { width: 0.8, m: 0.7, alpha: 0.35, group: 1 });
    const outer2K = ring(1.82, outerN, -0.018);
    dashed(outer2K, 1, 0.02, 0.12, 0.02, 0.1, { width: 0.9, m: 0.6, alpha: 0.3, group: 1 });
    const merK = ring(1.42, [1, 0.05, 0.25], 0.03);
    poly(arc(merK, 0, TAU, 1, 0.6), { width: 0.7, m: 0.5, alpha: 0.22, group: 1 });
    for (let i = 0; i < (dense ? 36 : 18); i++) trace(outerK, { width: 1.1, m: 0.85, alpha: 0.5, group: 2 });
    for (let i = 0; i < (dense ? 14 : 6); i++) trace(bandK, { width: 1.0, m: 0.8, alpha: 0.45, group: 2 });

    // Rays shooting out from the core, and long threads crossing the whole hologram.
    const spokes = [];
    for (let i = 0; i < (dense ? 26 : 14); i++) {
      const a = R(0, TAU);
      const d = norm(Math.cos(a), Math.sin(a), R(-0.35, 0.35));
      const r0 = R(0.16, 0.32);
      const r1 = dense ? R(1.2, 3.0) : R(1.1, 1.9);
      spokes.push({ d, r0, r1, ph: rand() });
      poly([[1, d[0] * r0, d[1] * r0, d[2] * r0, 1, 0], [1, d[0] * r1, d[1] * r1, d[2] * r1, 0.25, 1]],
        { width: 1, m: 0.8, alpha: R(0.25, 0.6), group: 3 });
    }
    const onSphere = (r) => {
      const u = R(-1, 1);
      const a = R(0, TAU);
      const s = Math.sqrt(1 - u * u);
      return [Math.cos(a) * s * r, u * r, Math.sin(a) * s * r];
    };
    for (let i = 0; i < (dense ? 12 : 6); i++) {
      const p = onSphere(dense ? 1.65 : 1.5);
      const q = onSphere(dense ? 1.65 : 1.5);
      poly([[1, p[0], p[1], p[2], 0.8, 0], [1, q[0], q[1], q[2], 0.8, 1]], { width: 0.9, m: 0.7, alpha: R(0.12, 0.3), group: 4 });
    }

    // Waves that spread from the core like ripples on water, and the ring that takes a voice's shape.
    const ripples = [];
    for (let i = 0; i < 4; i++) {
      const k = ring(0.2, coreN, 0.1, { alpha: 0, wob: 2.2 });
      ripples.push({ k, age: 9, str: 0 });
      poly(arc(k, 0, TAU, 1, 1, 0.046), { width: 1.6, m: 1, alpha: 0.85, group: 5 }); // they grow, so keep them fine
    }
    const voiceK = ring(0.37, coreN, 0.3, { voice: true });
    poly(arc(voiceK, 0, TAU, 1, 1, 0.05), { width: 1.5, m: 1, alpha: 0.9, group: 6 });

    // Dots: out-of-focus bokeh (many along the band), sparks riding the rings, sparks near the core.
    const bokeh = [];
    const bandRing = rings[bandK];
    for (let i = 0; i < (dense ? 70 : 30); i++) {
      let p;
      if (rand() < 0.45) {
        const th = R(0, TAU);
        const rr = bandRing.r * R(0.85, 1.18);
        p = [0, 1, 2].map((c) => rr * (Math.cos(th) * bandRing.u[c] + Math.sin(th) * bandRing.v[c]) + R(-0.08, 0.08));
      } else {
        p = dense ? [R(-2.6, 2.6), R(-1.8, 1.8), R(-2.2, 1.6)] : [R(-1.8, 1.8), R(-1.2, 1.2), R(-1.5, 1.2)];
      }
      bokeh.push({ p, size: R(0.6, 1.4), hue: rand(), drift: R(0.5, 1.5) });
    }
    const sparkRings = [k44, k58, k76, bandK, tiltK, outerK, outer2K];
    const sparks = [];
    for (let i = 0; i < (dense ? 240 : 100); i++) {
      sparks.push([sparkRings[Math.floor(rand() * sparkRings.length)], R(0, TAU), R(0.9, 1.12), rand()]);
    }
    const near = [];
    for (let i = 0; i < (dense ? 40 : 20); i++) near.push({ p: onSphere(R(0.2, 0.6)), seed: rand() });

    const T = pts.length;
    const kind = new Uint8Array(T);
    const a0 = new Float32Array(T);
    const a1 = new Float32Array(T);
    const a2 = new Float32Array(T);
    const bright = new Float32Array(T);
    const along = new Float32Array(T);
    // Ring points keep the sine and cosine of their angle (and 5x it, for the ripple), so each
    // frame only rotates them instead of calling sin and cos for every point.
    const cth = new Float32Array(T), sth = new Float32Array(T), c5 = new Float32Array(T), s5 = new Float32Array(T);
    pts.forEach((p, i) => {
      kind[i] = p[0];
      a0[i] = p[1];
      a1[i] = p[2];
      a2[i] = p[3];
      bright[i] = p[4];
      along[i] = p[5];
      if (p[0] === 0) {
        cth[i] = Math.cos(p[2]);
        sth[i] = Math.sin(p[2]);
        c5[i] = Math.cos(5 * p[2]);
        s5[i] = Math.sin(5 * p[2]);
      }
    });
    let idxCount = 0;
    for (const pl of polys) idxCount += (pl.count - 1) * 6;
    const index = new Uint16Array(idxCount);
    let q = 0;
    for (const pl of polys) {
      const b = pl.start * 2;
      for (let i = 0; i < pl.count - 1; i++) {
        const v = b + i * 2;
        index[q++] = v;
        index[q++] = v + 1;
        index[q++] = v + 2;
        index[q++] = v + 1;
        index[q++] = v + 3;
        index[q++] = v + 2;
      }
    }
    const dotCount = bokeh.length + sparks.length + nodes.length + near.length + spokes.length;
    this.geo = {
      rings, polys, kind, a0, a1, a2, bright, along, cth, sth, c5, s5, T, index, idxCount,
      spokes, ripples, bokeh, sparks, nodes, near, dotCount,
      sx: new Float32Array(T),
      sy: new Float32Array(T),
      df: new Float32Array(T),
      lineVerts: new Float32Array(T * 2 * 8),
      dotVerts: new Float32Array(dotCount * 8),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    // The full-screen world is soft light, so it can render below screen resolution.
    const scale = this.world ? Math.min(dpr, 1.5) * 0.9 * this.quality : Math.min(dpr, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * scale));
    this.canvas.height = Math.max(1, Math.round(rect.height * scale));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.world) this.makeTargets();
    this.place();
  }

  /** Offscreen images for the bloom: the scene at full size, and two half-size ones to blur. */
  makeTargets() {
    const gl = this.gl;
    for (const t of Object.values(this.targets || {})) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    this.targets = null;
    const made = [];
    const make = (w, h) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const target = { tex, fb, w, h };
      made.push(target);
      return ok ? target : null;
    };
    const W = this.canvas.width, H = this.canvas.height;
    const scene = make(W, H);
    const a = make(Math.max(1, W >> 1), Math.max(1, H >> 1));
    const b = make(Math.max(1, W >> 1), Math.max(1, H >> 1));
    if (scene && a && b) this.targets = { scene, a, b };
    else for (const t of made) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } // no bloom on this PC
  }

  /** Where the orb sits on the canvas, in canvas pixels (origin bottom-left). */
  place() {
    const cr = this.canvas.getBoundingClientRect(), ar = this.anchor.getBoundingClientRect();
    if (!cr.width || !ar.width) return;
    const sx = this.canvas.width / cr.width;
    this.cx = (ar.left + ar.width / 2 - cr.left) * sx;
    this.cy = (cr.bottom - (ar.top + ar.height / 2)) * sx;
    this.radius = Math.min(ar.width, ar.height) * 0.48 * sx;
    this.unit = this.radius * (this.world ? 0.62 : 0.5); // the hologram's size unit; its outer ring is 1.82 units
  }

  setMode(mode) {
    if (mode !== this.mode && (mode === "listening" || mode === "speaking")) this.pulse(0.35);
    this.mode = mode;
  }
  setLevel(v) { this.input = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  /** A wave of light that ripples outward from the core. */
  pulse(strength = 1) {
    if (!REDUCED) this.queued.push(Math.min(1, 0.3 + 0.5 * strength));
  }

  start({ intro = false } = {}) {
    if (intro) { this.intro = REDUCED ? 1 : 0; this.pulse(0.5); }
    if (this.running) return;
    this.running = true;
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) { this.raf = requestAnimationFrame(this.frame); return; }
    if (!REDUCED) this.t += dt;
    const m = this.mode;
    const target = m === "speaking" ? audio.level() : m === "listening" || this.compact ? this.input : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt * (target > this.level ? 14 : 4)));
    const ease = 1 - Math.exp(-dt * 4);
    this.listenAmt += (+(m === "listening") - this.listenAmt) * ease;
    this.thinkAmt += (+(m === "thinking") - this.thinkAmt) * ease;
    this.speakAmt += (+(m === "speaking") - this.speakAmt) * ease;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * ease;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * ease;
    this.intro = Math.min(1, this.intro + dt / 1.3);
    // Keep the full-screen world smooth on slower graphics: render it smaller if frames run long.
    if (this.world && dt > 0.03) {
      if (++this.slowFrames > 40 && this.quality > 0.6) { this.quality = Math.max(0.6, this.quality * 0.8); this.slowFrames = 0; this.resize(); }
    } else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.lost && this.unit) {
      try {
        this.draw(dt);
      } catch (e) {
        if (!this.failed && typeof report === "function") report("orb-error", { message: String(e.message || e).slice(0, 300) });
        this.failed = true;
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The recent voice as 64 smoothed values, for the ring around the core. False if there's none. */
  readWave() {
    const wave = this.waveSource?.();
    const bins = this.waveBins, N = bins.length;
    if (!wave || wave.length < N) return false;
    const step = wave.length / N;
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const i0 = Math.floor(i * step), i1 = Math.max(i0 + 1, Math.floor((i + 1) * step));
      let s = 0;
      for (let j = i0; j < i1; j++) s += wave[j] || 0;
      bins[i] += (s / (i1 - i0) - bins[i]) * 0.5;
      peak = Math.max(peak, Math.abs(bins[i]));
    }
    this.wavePeak += (Math.max(peak, 0.02) - this.wavePeak) * (peak > this.wavePeak ? 0.5 : 0.05);
    return true;
  }

  draw(dt) {
    const { gl, geo: G } = this;
    const motion = REDUCED ? 0 : 1;
    const t = this.t;
    const L = this.level, listen = this.listenAmt, think = this.thinkAmt, speak = this.speakAmt;
    const idle = Math.max(0, 1 - listen - think - speak);
    const energy = 0.62 * idle + 0.85 * listen + 0.95 * think + (0.9 + 0.75 * L) * speak;
    const spinMul = idle + 1.4 * listen + 4.5 * think + (1.6 + 0.8 * L) * speak;
    this.waveClock += dt * motion * (2.2 + 2.5 * think + 3 * L * speak);
    this.roll += dt * motion * 0.025 * spinMul;

    const light = this.compact && !this.darkPage.matches;
    const pal = light ? ORB_PALETTES.light : ORB_PALETTES.dark;
    const { deep, hot } = pal;
    const toCyan = listen * 0.45;
    const main = pal.main.map((v, i) => v + (pal.cyan[i] - v) * toCyan); // aqua while she listens
    const W = this.canvas.width, H = this.canvas.height;
    const U = this.unit, cx = this.cx, cy = this.cy;
    const lineScale = Math.min(1.4, Math.max(0.55, U / 150));
    const wob = 0.006 + 0.012 * think + 0.035 * L * speak + 0.012 * L * listen;
    const coreScale = 1 + 0.03 * Math.sin(t * 1.4) * idle + 0.22 * L * speak + 0.06 * L * listen;
    const { rings, polys, kind, a0, a1, a2, bright, along, cth, sth, c5, s5, T, sx, sy, df } = G;

    // Rings turn; when the orb opens each one grows in, from the core outward.
    for (const rg of rings) {
      rg.spin += dt * motion * rg.speed * spinMul;
      const rv = Math.max(0, Math.min(1, (this.intro - (rg.base / 1.9) * 0.55) / 0.45));
      rg.reveal = 1 - Math.pow(1 - rv, 3);
      if (rg.core) rg.r = rg.base * coreScale;
    }
    const sRev = 1 - Math.pow(1 - Math.max(0, Math.min(1, (this.intro - 0.25) / 0.6)), 3);
    const shown = 1 - Math.pow(1 - this.intro, 3);

    // Waves: on every loud syllable while she speaks, when asked (pulse), and now and then at rest.
    this.sinceRipple += dt;
    const spawn = (strength) => {
      let slot = G.ripples[0];
      for (const r of G.ripples) if (r.age > slot.age) slot = r;
      slot.age = 0;
      slot.str = strength;
      this.sinceRipple = 0;
    };
    while (this.queued.length) spawn(this.queued.shift());
    if (!REDUCED) {
      if (speak > 0.3 && L > 0.45 && this.prevLevel <= 0.45 && this.sinceRipple > 0.18) spawn(0.45 + 0.5 * L);
      if (idle > 0.6 && this.sinceRipple > 5) spawn(0.25);
    }
    this.prevLevel = L;
    const reach = this.compact ? 1.5 : 1.9;
    for (const r of G.ripples) {
      r.age += dt;
      const p = Math.min(1, r.age / 1.9);
      rings[r.k].r = 0.2 + (reach - 0.2) * (1 - (1 - p) * (1 - p));
      rings[r.k].alpha = r.age < 1.9 ? Math.pow(1 - p, 1.6) * r.str : 0;
    }

    // The ring around the core takes the shape of the voice: yours while she listens, hers while she speaks.
    const hasWave = this.readWave();
    const bins = this.waveBins, NB = bins.length;
    const gain = 1 / Math.max(0.02, this.wavePeak);
    const voiceAmp = 0.03 + 0.14 * L;
    const voiceShape = (a) => {
      if (!hasWave) return 0.5 * Math.sin(7 * a + t * 5) + 0.3 * Math.sin(13 * a - t * 8) + 0.2 * Math.sin(3 * a + t * 2);
      let u = ((a / Math.PI) % 2 + 2) % 2; // mirrored, so the ring closes smoothly
      if (u > 1) u = 2 - u;
      const f = u * (NB - 1), i = Math.floor(f), k = f - i;
      const v = bins[i] + (bins[Math.min(NB - 1, i + 1)] - bins[i]) * k;
      return Math.max(-1, Math.min(1, v * gain));
    };

    // The camera sways gently and leans toward the mouse, so the layers move against each other.
    const yaw = 0.22 * Math.sin(t * 0.13) * motion + this.pointer.x * 1.5;
    const pitch = 0.3 + 0.05 * Math.sin(t * 0.19) * motion - this.pointer.y * 1.5;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const FOC = 3.873, CAM = 4;
    let ox = 0, oy = 0, od = 0;
    const place = (x, y, z) => {
      const x1 = x * cyw + z * syw;
      const z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const s = FOC / Math.max(0.6, CAM - z2);
      ox = cx + x1 * s * U;
      oy = cy + y2 * s * U;
      od = Math.max(0, Math.min(1, (z2 + 1.6) / 3.2));
      return z2;
    };
    let px = 0, py = 0, pz = 0;
    const polar = (k, th, rf) => {
      const rg = rings[k];
      const a = th + rg.spin;
      let rr = rg.r * rf * (0.5 + 0.5 * rg.reveal);
      if (rg.voice) rr *= 1 + voiceAmp * voiceShape(a);
      else rr *= 1 + wob * rg.wob * Math.sin(5 * a + rg.ph - this.waveClock);
      const ca = Math.cos(a), sa = Math.sin(a);
      px = rg.c[0] + rr * (ca * rg.u[0] + sa * rg.v[0]);
      py = rg.c[1] + rr * (ca * rg.u[1] + sa * rg.v[1]);
      pz = rg.c[2] + rr * (ca * rg.u[2] + sa * rg.v[2]);
    };
    const fixed = (x, y, z, grow = 1) => {
      const g = 0.35 + 0.65 * grow;
      px = (x * cr - y * sr) * g;
      py = (x * sr + y * cr) * g;
      pz = z * g;
    };

    for (const rg of rings) {
      rg.cs = Math.cos(rg.spin);
      rg.sn = Math.sin(rg.spin);
      const K = 5 * rg.spin + rg.ph - this.waveClock;
      rg.cK = Math.cos(K);
      rg.sK = Math.sin(K);
      rg.scale = rg.r * (0.5 + 0.5 * rg.reveal);
    }
    for (let i = 0; i < T; i++) {
      if (kind[i] === 0) {
        // The same as polar(), using each point's stored sine and cosine.
        const rg = rings[a0[i]];
        const ca = cth[i] * rg.cs - sth[i] * rg.sn;
        const sa = sth[i] * rg.cs + cth[i] * rg.sn;
        let rr = rg.scale * a2[i];
        if (rg.voice) rr *= 1 + voiceAmp * voiceShape(Math.atan2(sa, ca));
        else rr *= 1 + wob * rg.wob * (s5[i] * rg.cK + c5[i] * rg.sK);
        px = rg.c[0] + rr * (ca * rg.u[0] + sa * rg.v[0]);
        py = rg.c[1] + rr * (ca * rg.u[1] + sa * rg.v[1]);
        pz = rg.c[2] + rr * (ca * rg.u[2] + sa * rg.v[2]);
      } else fixed(a0[i], a1[i], a2[i], sRev);
      place(px, py, pz);
      sx[i] = ox;
      sy[i] = oy;
      df[i] = od;
    }

    // How bright each group is in this state.
    const voiceShow = Math.max(listen, speak * 0.85) * (0.35 + 0.9 * L);
    const groupAlpha = [
      0.75 + 0.45 * energy + 0.6 * L * speak,
      0.55 + 0.4 * energy,
      0.6 + 0.3 * energy,
      0.5 + 0.35 * energy + 0.8 * L * speak,
      0.5 + 0.3 * energy,
      1,
      voiceShow,
    ];
    const groupHot = [0.45 + 0.4 * L * speak, 0.05, 0.1, 0.15, 0.1, 0.6, 0.55];
    const pulseSpeed = 0.35 * idle + 0.6 * listen + 1.8 * think + (0.8 + 0.6 * L) * speak;
    const alphaMul = light ? 1.35 : 1;

    const LV = G.lineVerts;
    let o = 0;
    for (const pl of polys) {
      let gA = groupAlpha[pl.group] * alphaMul;
      if (pl.group === 3 || pl.group === 4) gA *= (1 + think * 0.8 * Math.max(0, Math.sin(t * 9 + pl.id * 1.7))) * sRev;
      if (pl.k >= 0) gA *= rings[pl.k].reveal;
      if (pl.group === 5) gA *= rings[pl.k].alpha;
      const isTrace = pl.group === 2;
      if (isTrace) {
        pl.pp += dt * motion * pulseSpeed * pl.speed;
        if (pl.pp > 1.4) pl.pp = -0.4 - Math.random() * (2.5 - 2 * think); // signals running along the circuit
      }
      const hw = (pl.width * 2.6 + 1.2) * lineScale * 1.6;
      const m = pl.m;
      const br = deep[0] + (main[0] - deep[0]) * m;
      const bgc = deep[1] + (main[1] - deep[1]) * m;
      const bb = deep[2] + (main[2] - deep[2]) * m;
      const end = pl.start + pl.count - 1;
      for (let i = pl.start; i <= end; i++) {
        // Offset both sides of the thread along the averaged normal, so joints stay smooth.
        const ia = i > pl.start ? i - 1 : i;
        const ib = i < end ? i + 1 : i;
        let dx1 = sx[i] - sx[ia], dy1 = sy[i] - sy[ia];
        let dx2 = sx[ib] - sx[i], dy2 = sy[ib] - sy[i];
        const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1), l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (l1 > 1e-4) { dx1 /= l1; dy1 /= l1; }
        if (l2 > 1e-4) { dx2 /= l2; dy2 /= l2; }
        if (l1 <= 1e-4) { dx1 = dx2; dy1 = dy2; }
        if (l2 <= 1e-4) { dx2 = dx1; dy2 = dy1; }
        let tx = dx1 + dx2, ty = dy1 + dy2;
        let tl = Math.sqrt(tx * tx + ty * ty);
        if (tl < 1e-4) { tx = dx2 || 1; ty = dy2; tl = Math.sqrt(tx * tx + ty * ty) || 1; }
        tx /= tl;
        ty /= tl;
        const miter = Math.min(2.2, 1 / Math.max(0.45, tx * dx2 + ty * dy2));
        const nx = -ty * hw * miter, ny = tx * hw * miter;
        const pulse = isTrace ? Math.exp(-(((along[i] - pl.pp) / 0.08) ** 2)) : 0;
        const k = df[i];
        const h = Math.min(1, groupHot[pl.group] + pulse);
        const r = br + (hot[0] - br) * h, g = bgc + (hot[1] - bgc) * h, b = bb + (hot[2] - bb) * h;
        const a = Math.min(1, (pl.alpha * gA * bright[i] + pulse * 0.9 * gA) * (0.3 + 0.7 * k));
        LV[o++] = sx[i] + nx; LV[o++] = sy[i] + ny; LV[o++] = 1; LV[o++] = hw; LV[o++] = r; LV[o++] = g; LV[o++] = b; LV[o++] = a;
        LV[o++] = sx[i] - nx; LV[o++] = sy[i] - ny; LV[o++] = -1; LV[o++] = hw; LV[o++] = r; LV[o++] = g; LV[o++] = b; LV[o++] = a;
      }
    }

    const DV = G.dotVerts;
    let d = 0;
    const maxPoint = this.maxPoint;
    const dot = (x, y, size, kindOf, r, g, b, a) => {
      DV[d++] = x; DV[d++] = y; DV[d++] = Math.min(maxPoint, size); DV[d++] = kindOf;
      DV[d++] = r; DV[d++] = g; DV[d++] = b; DV[d++] = Math.max(0, Math.min(1, a * shown));
    };
    const dotScale = lineScale * 1.6;
    // Bokeh: larger and softer the further it is from the focus.
    G.bokeh.forEach((bk, i) => {
      fixed(bk.p[0], bk.p[1] + 0.05 * Math.sin(t * 0.3 * bk.drift + i), bk.p[2]);
      const z = place(px, py, pz);
      const blur = Math.abs(z - 0.3);
      const mixHot = bk.hue * 0.6;
      dot(ox, oy, (5 + blur * 26) * bk.size * dotScale, 1,
        main[0] + (hot[0] - main[0]) * mixHot, main[1] + (hot[1] - main[1]) * mixHot, main[2] + (hot[2] - main[2]) * mixHot,
        (0.32 / (1 + blur * 2.2)) * (0.55 + 0.45 * energy) * (light ? 0.6 : 1));
    });
    // Sparks riding the rings.
    for (const s of G.sparks) {
      polar(s[0], s[1], s[2]);
      place(px, py, pz);
      const tw = 0.5 + 0.5 * Math.sin(t * (2 + s[3] * 3) + s[3] * 50);
      dot(ox, oy, (2.2 + 2 * s[3]) * dotScale, 0, hot[0], hot[1], hot[2], tw * 0.9 * (0.3 + 0.7 * od) * (0.6 + 0.4 * energy) * rings[s[0]].reveal);
    }
    // Little squares at the ends of circuit traces.
    for (const nd of G.nodes) {
      polar(nd[0], nd[1], nd[2]);
      place(px, py, pz);
      dot(ox, oy, 4.5 * dotScale, 2, main[0], main[1], main[2], 0.75 * (0.3 + 0.7 * od) * rings[nd[0]].reveal);
    }
    // Sparks drifting around the core.
    G.near.forEach((n, i) => {
      const a = t * (0.2 + n.seed * 0.3) * spinMul * 0.4 + i;
      const c = Math.cos(a), s = Math.sin(a);
      place(n.p[0] * c - n.p[2] * s, n.p[1], n.p[0] * s + n.p[2] * c);
      dot(ox, oy, (2.5 + 2 * n.seed) * dotScale, 0, hot[0], hot[1], hot[2], (0.5 + 0.5 * Math.sin(t * 3 + n.seed * 40)) * (0.5 + 0.5 * energy));
    });
    // While she listens (and thinks), light travels in along the rays toward the core.
    G.spokes.forEach((spk, i) => {
      const u = 1 - ((t * 0.45 * (1 + (i % 3) * 0.2) + spk.ph) % 1);
      const r = spk.r0 + (Math.min(spk.r1, 1.6) - spk.r0) * u;
      fixed(spk.d[0] * r, spk.d[1] * r, spk.d[2] * r, sRev);
      place(px, py, pz);
      dot(ox, oy, 3.5 * dotScale, 0, hot[0], hot[1], hot[2], (listen + 0.6 * think) * 0.9 * Math.sin(Math.PI * u));
    });

    const bloom = this.world ? this.targets : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom ? bloom.scene.fb : null);
    gl.viewport(0, 0, W, H);
    if (this.world) {
      gl.disable(gl.BLEND);
      this.quad("backdrop", () => {
        const u = this.u.backdrop;
        gl.uniform2f(u.uRes, W, H);
        gl.uniform2f(u.uCenter, cx, cy);
        gl.uniform1f(u.uUnit, U);
        gl.uniform1f(u.uTime, t % 3600);
        gl.uniform4f(u.uMood, L, listen, think, speak);
        gl.uniform1f(u.uIntro, shown);
      });
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.enable(gl.BLEND);
    if (light) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE);
    const bind = (locs) => {
      for (const l of locs) gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(locs[0], 2, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(locs[1], 2, gl.FLOAT, false, 32, 8);
      gl.vertexAttribPointer(locs[2], 4, gl.FLOAT, false, 32, 16);
    };
    const unbind = (locs) => { for (const l of locs) gl.disableVertexAttribArray(l); };

    gl.useProgram(this.progs.line);
    gl.uniform2f(this.u.line.uRes, W, H);
    gl.uniform1f(this.u.line.uGlow, light ? 0.12 : 0.32);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, LV, gl.DYNAMIC_DRAW);
    bind(this.loc.line);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.drawElements(gl.TRIANGLES, G.idxCount, gl.UNSIGNED_SHORT, 0);
    unbind(this.loc.line);

    gl.useProgram(this.progs.dot);
    gl.uniform2f(this.u.dot.uRes, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, DV, gl.DYNAMIC_DRAW);
    bind(this.loc.dot);
    gl.drawArrays(gl.POINTS, 0, G.dotCount);
    unbind(this.loc.dot);
    gl.disable(gl.BLEND);

    if (bloom) {
      // Keep the bright parts at half size, blur them twice (wider the second time), add them back.
      const { scene, a, b } = bloom;
      const pass = (into, name, tex, setup) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null);
        gl.viewport(0, 0, into ? into.w : W, into ? into.h : H);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        this.quad(name, setup);
      };
      pass(a, "bright", scene.tex, () => {
        gl.uniform1i(this.u.bright.uTex, 0);
        gl.uniform1f(this.u.bright.uCut, 0.22);
      });
      for (const [from, into, sx2, sy2] of [[a, b, 1, 0], [b, a, 0, 1], [a, b, 2, 0], [b, a, 0, 2]]) {
        pass(into, "blur", from.tex, () => {
          gl.uniform1i(this.u.blur.uTex, 0);
          gl.uniform2f(this.u.blur.uStep, sx2 / from.w, sy2 / from.h);
        });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      this.quad("composite", () => {
        gl.uniform1i(this.u.composite.uScene, 0);
        gl.uniform1i(this.u.composite.uBloom, 1);
        gl.uniform1f(this.u.composite.uAmount, 0.75 + 0.35 * energy + 0.9 * (1 - shown)); // a flash as it opens
      });
    }
  }

  /** Draws a full-screen pass with one of the quad programs. */
  quad(name, setup) {
    const gl = this.gl, loc = this.loc.quad[name];
    gl.useProgram(this.progs[name]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
  }
}
