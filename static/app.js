"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  chat: $("chat"), welcome: $("welcome"), messages: $("messages"), heroOrb: $("heroOrb"),
  composer: $("composer"), input: $("input"), send: $("sendBtn"), mic: $("micBtn"),
  liveBtn: $("liveBtn"), wakeBtn: $("wakeBtn"), webBtn: $("webBtn"), model: $("model"),
  status: $("status"), speakToggle: $("speakToggle"), newChat: $("newChat"),
  footnote: $("footnote"), banner: $("banner"), toast: $("toast"),
  settingsBtn: $("settingsBtn"), settings: $("settings"), voiceSel: $("voiceSel"),
  styleSeg: $("styleSeg"), echoSeg: $("echoSeg"), sfxSeg: $("sfxSeg"), hearingSeg: $("hearingSeg"), previewVoice: $("previewVoice"),
  geminiState: $("geminiState"), geminiKey: $("geminiKey"), geminiSave: $("geminiSave"), geminiRemove: $("geminiRemove"),
  greeting: $("greeting"), addressSel: $("addressSel"), addressName: $("addressName"),
  magicules: $("magicules"), menuBtn: $("menuBtn"), sidebar: $("sidebar"), scrim: $("scrim"),
  chatList: $("chatList"), sideNew: $("sideNew"), toBottom: $("toBottom"),
  claudeState: $("claudeState"), claudeKey: $("claudeKey"), claudeSave: $("claudeSave"),
  claudeRemove: $("claudeRemove"), preferField: $("preferField"), preferSeg: $("preferSeg"),
  groqState: $("groqState"), groqKey: $("groqKey"), groqSave: $("groqSave"), groqRemove: $("groqRemove"),
  live: $("live"), orb: $("orb"), orbSpot: $("orbSpot"), liveState: $("liveState"), subYou: $("subYou"),
  subNexa: $("subNexa"), liveInterrupt: $("liveInterrupt"), liveEnd: $("liveEnd"),
  emblem: $("emblem"),
  ownerState: $("ownerState"), ownerPrompt: $("ownerPrompt"), ownerEnroll: $("ownerEnroll"),
  ownerCancel: $("ownerCancel"), ownerRemove: $("ownerRemove"),
};
const FOOTNOTE = els.footnote.textContent;
const PLACEHOLDER = els.input.placeholder;
const TAU = Math.PI * 2;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  history: [],        // [{role, content}] sent to the model each turn
  busy: false,
  abort: null,        // AbortController for the reply being generated
  speaker: null,      // SentenceSpeaker for the reply being read aloud
  speakReplies: loadPref("speak", false),
  web: loadPref("web", true),
  tts: false,         // Nexa's own voice (Piper) is installed on the server
  voice: loadPref("voiceNexa", ""),
  style: loadPref("style", "calm").replace("raphael", "calm"), // "calm" was once called "raphael"
  echo: loadPref("echo", 1),
  sfx: loadPref("sfx", true), // anime-style sound effects
  hearing: loadPref("hearing", "accurate"), // "accurate" re-reads phrases meant for her with a bigger model
  gemini: { configured: false, models: [] }, // optional online brain (Gemini API, free tier)
  claude: { configured: false, models: [] }, // optional online brain (Claude API, paid)
  groq: { configured: false, models: [] },   // optional online brain (Groq API, free and fast)
  prefer: loadPref("prefer", "groq"),        // which online brain Auto tries first
  address: loadPref("address", "auto"),      // "auto" (guess by voice), "Sir", "Ma'am", "Master", "name", "none"
  addressName: loadPref("addressName", ""),
  voiceGuess: "",                            // Auto mode's latest guess: "Sir", "Ma'am" or ""
  owner: { enrolled: false, ready: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPref(key, fallback) {
  try {
    // Settings saved before she was renamed Nexa are kept under her first name, Ciel.
    const v = localStorage.getItem("nexa." + key) ?? localStorage.getItem("ciel." + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("nexa." + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Sends a troubleshooting event to the server log (logs/nexa.log). */
function report(event, data = {}) {
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}

/* ---------- Status, banner and toast ---------- */

let modelKey = "", statusTimer = 0, linesWarmed = false;
async function refreshStatus() {
  let loading = false;
  try {
    const s = await (await fetch("/api/status")).json();
    state.tts = s.tts_ready;
    state.owner = s.owner || { enrolled: false, ready: false };
    renderOwner();
    if (state.owner.enrolled && wake.enabled) wakeLoop();
    if (s.tts_ready && !linesWarmed) { linesWarmed = true; warmLines(); }
    // Keep Accurate as the default on every PC; Fast remains an explicit choice.
    renderModels(s.models.length ? s.models : [s.default_model], s.default_model);
    // Which online brain the current choice would use first, if any.
    const v = els.model.value;
    const firstOnline = BRAIN_ORDER.find((p) => v.startsWith(`${p}:`))
      || (v === "auto" ? brainOrder().find((p) => s[p]) : "") || "";
    const name = BRAIN_NAMES[firstOnline];
    loading = s.ollama && s.models.length && !s.model_ready;
    if (!s.ollama) setStatus("bad", "Ollama not running");
    else if (!s.models.length) setStatus("bad", "No model installed");
    else if (loading) setStatus("", "Loading model…");
    else if (firstOnline && !s.online) setStatus("ok", "Offline · using Gemma");
    else if (firstOnline && s[`${firstOnline}_resting`]) setStatus("ok", `${name} limit reached · using backup`);
    else if (s.online && firstOnline) setStatus("online", `Online · ${name}`);
    else if (s.online && state.web) setStatus("online", "Online · web search");
    else setStatus("ok", s.online ? "Online · web search off" : "Offline · on this PC");
  } catch {
    setStatus("bad", "Server stopped");
  }
  clearTimeout(statusTimer);
  statusTimer = setTimeout(refreshStatus, loading ? 2000 : 10000);
}
// Online brains: Auto tries the preferred one, then the free ones before the paid one.
const BRAIN_ORDER = ["groq", "gemini", "claude"];
const BRAIN_NAMES = { groq: "Groq", gemini: "Gemini", claude: "Claude" };
const brainOrder = () => [state.prefer, ...BRAIN_ORDER.filter((p) => p !== state.prefer)];

/** Model menu: Auto, local models (offline), and Groq / Gemini / Claude models when their keys are saved. */
function renderModels(local, defaultModel) {
  const gem = state.gemini.models, cla = state.claude.models, grq = state.groq.models;
  const key = [...local, ...gem.map((g) => g.id), ...cla.map((c) => c.id), ...grq.map((g) => g.id),
    state.gemini.configured, state.claude.configured, state.groq.configured].join("|");
  if (key === modelKey) return;
  modelKey = key;
  const wanted = els.model.value || loadPref("model", defaultModel);
  const group = (label, options) => {
    const g = document.createElement("optgroup");
    g.label = label;
    g.append(...options);
    return g;
  };
  const groups = [];
  if (state.gemini.configured || state.claude.configured || state.groq.configured) {
    // Auto: the preferred online brain, then the others, then Gemma when offline or over the limits.
    groups.push(group("Recommended", [new Option("✦ Auto · best online brain, Gemma offline", "auto")]));
  }
  groups.push(group("On this PC (works offline)", local.map((n) => new Option(n, n))));
  groups.push(group("Groq (online, free, fast)", state.groq.configured
    ? grq.map((g) => new Option(`✦ ${g.label}`, `groq:${g.id}`))
    : [new Option("✦ Add Groq (free)…", "groq-setup")]));
  groups.push(group("Claude (online, paid)", state.claude.configured
    ? cla.map((c) => new Option(`✦ ${c.label}`, `claude:${c.id}`))
    : [new Option("✦ Add Claude…", "claude-setup")]));
  groups.push(group("Gemini (online, free)", state.gemini.configured
    ? gem.map((g) => new Option(`✦ ${g.label}`, `gemini:${g.id}`))
    : [new Option("✦ Add Gemini (free)…", "gemini-setup")]));
  els.model.replaceChildren(...groups);
  const values = [...els.model.options].map((o) => o.value);
  els.model.value = values.includes(wanted) && !wanted.endsWith("-setup") ? wanted
    : values.includes(defaultModel) ? defaultModel : local[0];
  lastModel = els.model.value;
}
let lastModel = "";

function setStatus(kind, text) {
  els.status.className = "status " + kind;
  els.status.textContent = text;
}
function setFootnote(text) {
  els.footnote.textContent = text || (!state.owner.enrolled
    ? "Spoken requests paused. Enroll your voice in Settings > General."
    : wake.enabled ? "Listening for your voice… say “Hey Nexa” with a complete request." : FOOTNOTE);
}
function showBanner(text) {
  els.banner.textContent = text;
  els.banner.hidden = false;
}
function hideBanner() { els.banner.hidden = true; }

let toastTimer = 0;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
}

/* ---------- Minimal Markdown (no external libraries, so it works offline) ---------- */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const safeUrl = (url) => /^https?:\/\//i.test(url || "");

/* ---------- How she addresses you: Sir, Ma'am, Master, a name, or nothing ---------- */

/** The title to use right now. In Auto it's the latest guess from the voice ("" until she hears you). */
function addressWord() {
  const mode = state.address;
  if (mode === "auto") return state.voiceGuess;
  if (mode === "name") return state.addressName;
  return mode === "none" ? "" : mode;
}
/** "Yes" + "?" → "Yes, Sir?" (or "Yes?" with no title). */
const titled = (start, end) => (addressWord() ? `${start}, ${addressWord()}${end}` : `${start}${end}`);

/**
 * Auto mode: guess from the pitch of the voice speaking to her. Typical men speak
 * around 85–155 Hz and women around 165–255 Hz; in between she uses no title.
 */
function noteVoice(pitch) {
  if (state.address !== "auto" || !pitch) return;
  // Judge by the middle of the last three readings so one odd reading (a video playing
  // in the background, a laugh) can't flip Sir to Ma'am.
  state.pitches = [...(state.pitches || []).slice(-2), pitch];
  const sorted = [...state.pitches].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const guess = typical < 150 ? "Sir" : typical > 162 ? "Ma'am" : "";
  if (guess !== state.voiceGuess) {
    state.voiceGuess = guess;
    report("voice-guess", { pitch, guess: guess || "none" });
    updateGreeting();
  }
}

function updateGreeting() {
  const word = addressWord();
  const hour = new Date().getHours();
  const hello = hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
  els.greeting.textContent = word ? `${hello}, ${word}` : hello;
}

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inline(text, sources) {
  return text.split(/(`[^`\n]+`)/).map((part, i) => {
    if (i % 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    // Markdown links [text](https://…) are set aside first so nothing below rewrites their URLs.
    const links = [];
    const marked = part.replace(LINK_RE, (_, label, url) => `\u0001${links.push([label, url]) - 1}\u0001`);
    return escapeHtml(marked)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
        // Citations like [1] or [1, 3] become links to the matching search result.
        .replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (whole, nums) => {
          const links = nums.split(/\s*,\s*/).map((n) => {
            const src = sources[+n - 1];
            return src && safeUrl(src.url)
              ? `<a class="cite" href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(src.title)}">${n}</a>`
              : null;
          });
          return links.every(Boolean) ? links.join("") : whole;
        })
        .replace(/\u0001(\d+)\u0001/g, (_, n) =>
          `<a href="${escapeHtml(links[n][1])}" target="_blank" rel="noopener noreferrer">${escapeHtml(links[n][0])}</a>`);
  }).join("");
}

// A table's second line: |---|:---:|
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

function renderMarkdown(src, sources = []) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  const inl = (s) => inline(s, sources);
  let para = [], list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inl(para.join("\n")).replace(/\n/g, "<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const start = list.type === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
    out.push(`<${list.type}${start}>${list.items.map((it) => `<li>${inl(it)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w#+.-]*)/);
    if (fence) {
      flushPara(); flushList();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(
        `<div class="code"><div class="code-head"><span>${escapeHtml(fence[1] || "code")}</span>` +
        `<button class="copy-code" type="button">Copy</button></div>` +
        `<pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`
      );
      continue;
    }
    if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[i + 1] || "")) {
      flushPara(); flushList();
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const rows = [];
      i += 1; // skip the |---| line
      while (i + 1 < lines.length && TABLE_ROW_RE.test(lines[i + 1])) rows.push(cells(lines[++i]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      );
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)/);
    if (quote) {
      flushPara(); flushList();
      const quoted = [quote[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) quoted.push(lines[++i].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inl(quoted.join(" "))}</blockquote>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const ul = line.match(/^\s*[-*+]\s+(.*)/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); }
    else if (h) {
      flushPara(); flushList();
      const lvl = Math.min(h[1].length, 3);
      out.push(`<h${lvl}>${inl(h[2])}</h${lvl}>`);
    } else if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [], start: ol ? +ol[1] : 1 }; }
      list.items.push(ul ? ul[1] : ol[2]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join("");
}

/* ---------- Browser audio needs one click or key press before it may start ---------- */

let gestureWait = null;
function userGesture() {
  if (!gestureWait) {
    gestureWait = new Promise((resolve) => {
      const go = () => {
        window.removeEventListener("pointerdown", go, true);
        window.removeEventListener("keydown", go, true);
        gestureWait = null;
        resolve();
      };
      window.addEventListener("pointerdown", go, true);
      window.addEventListener("keydown", go, true);
    });
  }
  return gestureWait;
}
async function whenRunning(ctx) {
  if (ctx.state === "running") return;
  ctx.resume().catch(() => {});
  await sleep(250);
  while (ctx.state !== "running") {
    // Nexa's own window allows sound right away; a normal browser tab needs a click.
    report("waiting-for-click", { ctx: ctx.state });
    showBanner("Click anywhere to let Nexa listen for “Hey Nexa” and speak.");
    await userGesture();
    await ctx.resume().catch(() => {});
  }
  hideBanner();
}

/* ---------- Nexa's voice: offline neural TTS through an "inner voice" effect ---------- */

const ECHO_LEVELS = [[0, 0], [0.28, 0.2], [0.42, 0.4]]; // [shimmer, echo] for Off/Subtle/Strong

/** Counts what is playing so the corner emblem shows exactly while Nexa speaks. */
const speaking = {
  count: 0, timer: 0, quietUntil: 0,
  start() { this.count++; clearTimeout(this.timer); emblem.show(); },
  end() {
    this.count = Math.max(0, this.count - 1);
    this.quietUntil = performance.now() + 600; // let the speaker's echo fade before listening
    if (!this.count) { clearTimeout(this.timer); this.timer = setTimeout(() => emblem.hide(), 600); }
  },
};

const audio = {
  ctx: null, input: null, analyser: null, data: null, source: null,

  init() {
    if (this.ctx) return this.ctx;
    const ctx = this.ctx = new AudioContext();
    this.input = ctx.createGain();
    const mix = ctx.createGain();
    // A faint shimmer (slowly modulated short delay) and a soft echo make the
    // voice sound like it is speaking inside your head.
    const shimmer = ctx.createDelay(0.05);
    shimmer.delayTime.value = 0.011;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.4;
    depth.gain.value = 0.0018;
    lfo.connect(depth).connect(shimmer.delayTime);
    lfo.start();
    this.shimmerLevel = ctx.createGain();
    const echo = ctx.createConvolver();
    echo.buffer = impulse(ctx, 1.8, 3.2);
    this.echoLevel = ctx.createGain();
    this.setEcho(state.echo);
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 5000;
    air.gain.value = 3;
    this.input.connect(mix);
    this.input.connect(shimmer).connect(this.shimmerLevel).connect(mix);
    this.input.connect(echo).connect(this.echoLevel).connect(mix);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.data = new Float32Array(this.analyser.fftSize);
    mix.connect(air).connect(this.analyser).connect(ctx.destination);
    return ctx;
  },

  setEcho(level) {
    if (!this.ctx) return;
    const [shimmer, echo] = ECHO_LEVELS[level] || ECHO_LEVELS[1];
    this.shimmerLevel.gain.value = shimmer;
    this.echoLevel.gain.value = echo;
  },

  /** The last ~20 ms of Nexa's voice (drives the orb's waveform). */
  wave() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.data);
    return this.data;
  },

  /** Loudness of what Nexa is saying right now, 0..1. */
  level() {
    const d = this.wave();
    if (!d) return 0;
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.min(1, Math.sqrt(sum / d.length) * 3);
  },

  async play(buffer) {
    const ctx = this.init();
    await whenRunning(ctx);
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.input);
      src.onended = () => {
        if (this.source === src) this.source = null;
        speaking.end();
        resolve();
      };
      this.source = src;
      speaking.start();
      try { src.start(); }
      catch (e) {
        src.onended = null;
        this.source = null;
        speaking.end();
        throw e;
      }
    });
  },

  stop() {
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
  },
};

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/* ---------- Sound effects (made here with Web Audio, so they work offline) ---------- */

const sfx = {
  bus: null, white: null, analyzing: 0,

  /** The effects' own output, with a long reverb so they ring like her inner world. Null when off. */
  out() {
    const ctx = audio.init();
    if (!state.sfx || ctx.state !== "running") return null;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.9;
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx, 2.6, 2.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      this.bus.connect(ctx.destination);
      this.bus.connect(verb).connect(wet).connect(ctx.destination);
    }
    return this.bus;
  },

  tone(freq, at, dur, vol, { type = "sine", to = 0 } = {}) {
    const bus = this.out();
    if (!bus) return false;
    const ctx = audio.ctx, t = ctx.currentTime + at;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + Math.min(0.01, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return true;
  },

  /** A glassy bell (FM synthesis). */
  bell(freq, at, { dur = 1.2, vol = 0.12, ratio = 3.5, index = 2.2 } = {}) {
    const bus = this.out();
    if (!bus) return false;
    const ctx = audio.ctx, t = ctx.currentTime + at;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), depth = ctx.createGain(), env = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    depth.gain.setValueAtTime(freq * index, t);
    depth.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.6);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mod.connect(depth).connect(car.frequency);
    car.connect(env).connect(bus);
    for (const o of [car, mod]) { o.start(t); o.stop(t + dur + 0.05); }
    return true;
  },

  /** Filtered noise sweeping from one pitch to another: a whoosh. */
  whoosh(at, dur, vol, from, to, q = 1.2) {
    const bus = this.out();
    if (!bus) return false;
    const ctx = audio.ctx, t = ctx.currentTime + at;
    if (!this.white) {
      this.white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.white.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), env = ctx.createGain();
    src.buffer = this.white;
    band.type = "bandpass";
    band.Q.value = q;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(band).connect(env).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
    return true;
  },

  /** "I heard you": a quick two-note digital chime. */
  heard() {
    this.tone(1567.98, 0, 0.12, 0.09);
    this.tone(2093, 0.085, 0.25, 0.09);
  },

  /** Just before Nexa speaks: a crystalline "message" chime. True if it played. */
  notice() {
    const played = [880, 1318.5, 1760, 2637].map((f, i) => this.bell(f, i * 0.055, { dur: 1.4 - i * 0.15, vol: 0.07 }));
    this.whoosh(0, 0.5, 0.025, 3000, 9000, 3);
    return played.some(Boolean);
  },

  /** The magic circle opening: a low bloom, a rising whoosh and a shimmer of bells. */
  summon() {
    this.tone(55, 0, 0.9, 0.22, { to: 110 });
    this.whoosh(0, 0.7, 0.06, 300, 5000);
    [1046.5, 1568, 2093, 3136].forEach((f, i) => this.bell(f, 0.25 + i * 0.07, { dur: 1.6, vol: 0.05, ratio: 2.01, index: 1.2 }));
  },

  /** The circle closing. */
  dismiss() {
    this.whoosh(0, 0.6, 0.05, 5000, 300);
    this.bell(1568, 0.05, { dur: 1.0, vol: 0.06 });
    this.bell(1046.5, 0.16, { dur: 1.2, vol: 0.06 });
  },

  /** Searching the web: a sonar-like ping. */
  search() {
    this.tone(1244.5, 0, 0.5, 0.07, { to: 1100 });
    this.tone(1864.7, 0.14, 0.6, 0.04, { to: 1700 });
  },

  /** Thinking: soft data ticks until it's turned off. */
  analyze(on) {
    if (!on) { clearInterval(this.analyzing); this.analyzing = 0; return; }
    if (this.analyzing || !this.out()) return;
    const notes = [2093, 2349, 2637, 3136, 3520, 4186];
    this.analyzing = setInterval(() => {
      if (Math.random() < 0.65) this.tone(notes[(Math.random() * notes.length) | 0], 0, 0.04, 0.025, { type: "triangle" });
    }, 90);
  },
};

const clipCache = new Map(); // short, often-repeated lines like "Yes, Sir?"
function synthesize(text) {
  const key = `${state.voice}|${state.style}|${text}`;
  if (clipCache.has(key)) return clipCache.get(key);
  const clip = fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: state.voice, style: state.style }),
  })
    .then((r) => { if (!r.ok) throw new Error("tts failed"); return r.arrayBuffer(); })
    .then((bytes) => audio.init().decodeAudioData(bytes));
  if (text.length <= 40) {
    clipCache.set(key, clip);
    clip.catch(() => clipCache.delete(key));
  }
  return clip;
}
function warmLines() {
  // Prepare her short replies so they play the instant she hears "Hey Nexa".
  if (state.tts) {
    // Every title she might use right after hearing her name.
    const titles = state.address === "auto" ? ["Sir", "Ma'am", ""] : [addressWord()];
    const lines = titles.flatMap((t) => [t ? `Yes, ${t}?` : "Yes?", t ? `Talk to you later, ${t}.` : "Talk to you later."]);
    [...lines, "Got it."].forEach((line) => synthesize(line).catch(() => {}));
  }
}

// Fallback when Nexa's voice isn't installed: Windows' built-in offline voices.
let fallbackVoice = null;
function pickFallbackVoice() {
  const local = speechSynthesis.getVoices().filter((v) => v.localService);
  fallbackVoice = local.find((v) => /zira|aria|jenny|hazel|susan/i.test(v.name))
    || local.find((v) => v.lang.startsWith("en")) || local[0] || null;
}
if ("speechSynthesis" in window) {
  pickFallbackVoice();
  speechSynthesis.addEventListener("voiceschanged", pickFallbackVoice);
}

function cleanForSpeech(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "")
    .replace(/[*_#`>~|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speaks streamed text one sentence at a time so speech starts before the reply
 * ends. onstart(sentence) fires as each sentence begins (used for subtitles).
 */
class SentenceSpeaker {
  /** chime: ring a soft chime before the first sentence. */
  constructor({ chime = true } = {}) {
    this.chime = chime;
    this.buf = "";
    this.pending = 0;
    this.ended = false;
    this.cancelled = false;
    this.inCode = false;
    this.queue = Promise.resolve();
    this.utterances = []; // Chrome drops onend events for utterances it garbage-collects
    this.finished = new Promise((resolve) => { this.resolve = resolve; });
  }
  push(text) {
    this.buf += text;
    let m;
    while ((m = this.buf.match(/^[\s\S]*?(?:[.!?](?=\s)|\n)/))) {
      this.buf = this.buf.slice(m[0].length);
      this.say(m[0]);
    }
  }
  say(segment) {
    if (/```/.test(segment)) { this.inCode = !this.inCode; return; }
    if (this.inCode || this.cancelled) return;
    const text = cleanForSpeech(segment);
    if (!text) return;
    this.pending++;
    const done = () => { this.pending--; this.check(); };
    const clip = state.tts
      ? synthesize(text).catch((e) => { report("tts-error", { message: String(e) }); return null; })
      : Promise.resolve(null);
    this.queue = this.queue.then(async () => {
        const buffer = await clip;
        if (this.cancelled) return;
        if (this.chime) {
          this.chime = false;
          if (sfx.notice()) await sleep(320);
          if (this.cancelled) return;
        }
        if (buffer) {
          try {
            this.onstart?.(text);
            await audio.play(buffer);
            return;
          } catch (e) { report("playback-error", { message: String(e) }); }
        }
        await this.speakFallback(text);
      }).catch((e) => report("speech-error", { message: String(e) })).finally(done);
  }
  speakFallback(text) {
    if (this.cancelled || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      let started = false, finished = false;
      if (fallbackVoice) { u.voice = fallbackVoice; u.lang = fallbackVoice.lang; }
      u.rate = 0.95;
      u.onstart = () => {
        if (finished || this.cancelled) return;
        started = true;
        speaking.start();
        this.onstart?.(text);
      };
      u.onend = u.onerror = () => {
        if (finished) return;
        finished = true;
        if (started) speaking.end();
        resolve();
      };
      this.utterances.push(u);
      speechSynthesis.speak(u);
    });
  }
  end() {
    if (this.buf) this.say(this.buf);
    this.buf = "";
    this.ended = true;
    this.check();
  }
  check() {
    if (this.ended && this.pending <= 0) this.resolve();
  }
  cancel() {
    this.cancelled = true;
    this.ended = true;
    this.pending = 0;
    audio.stop();
    // Some browsers drop cancellation events. Release our speaking state explicitly.
    for (const utterance of this.utterances) utterance.onend?.();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    speaking.quietUntil = performance.now() + 600;
    this.resolve();
  }
}

function stopSpeaking() {
  state.speaker?.cancel();
  state.speaker = null;
}

/** Says a fixed line in Nexa's voice and waits until it has been spoken. */
async function sayLine(text, onstart, { chime = true } = {}) {
  stopSpeaking();
  const sp = state.speaker = new SentenceSpeaker({ chime });
  sp.onstart = onstart;
  sp.push(text);
  sp.end();
  await sp.finished;
  if (state.speaker === sp) state.speaker = null;
}

/* ---------- Microphone: one shared stream, many short listeners ---------- */

const mic = {
  stream: null, ctx: null, proc: null, rate: 48000, noise: 0.003, last: null,
  listeners: new Set(), closeTimer: 0, stat: { max: 0, sum: 0, n: 0 },

  async open() {
    clearTimeout(this.closeTimer);
    if (!this.ctx) {
      // Listeners that start together share one microphone instead of opening two.
      this.opening ||= this.connect().finally(() => { this.opening = null; });
      await this.opening;
    }
    await whenRunning(this.ctx);
  },
  async connect() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      report("mic-error", { name: e.name, message: e.message });
      throw e;
    }
    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.last = data.slice(); // for the orb's waveform
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      this.stat.max = Math.max(this.stat.max, rms);
      this.stat.sum += rms;
      this.stat.n++;
      for (const fn of [...this.listeners]) fn(data, rms);
    };
    source.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    const track = this.stream.getAudioTracks()[0];
    report("mic-open", { device: track?.label, rate: this.rate, ctx: this.ctx.state });
  },
  add(fn) {
    clearTimeout(this.closeTimer);
    this.listeners.add(fn);
  },
  remove(fn) {
    this.listeners.delete(fn);
    // Release the mic (and the browser's recording light) when nobody is listening.
    if (!this.listeners.size) this.closeTimer = setTimeout(() => this.close(), 2500);
  },
  close() {
    if (this.listeners.size || !this.ctx) return;
    this.proc.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close();
    this.ctx = this.stream = this.proc = this.last = null;
  },
};

// Every 20 s while the mic is open, log how loud the room is (helps tune the wake word).
setInterval(() => {
  if (!mic.ctx || !mic.stat.n) return;
  report("mic-level", {
    max: +mic.stat.max.toFixed(4), avg: +(mic.stat.sum / mic.stat.n).toFixed(4),
    noise: +mic.noise.toFixed(4), ctx: mic.ctx.state, wake: wake.enabled,
  });
  mic.stat = { max: 0, sum: 0, n: 0 };
}, 20000);

/**
 * Captures one spoken phrase from the shared mic. `result` resolves to 16 kHz
 * Int16 PCM once the speaker pauses, or to null if nothing was said in maxIdleMs.
 */
class Listener {
  constructor({ onLevel, maxIdleMs = Infinity, endSilenceMs = 1800, minVoicedMs = 300, maxSpeechMs = 35000 } = {}) {
    Object.assign(this, { onLevel, maxIdleMs, endSilenceMs, minVoicedMs, maxSpeechMs });
    this.chunks = [];
    this.done = false;
    this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.begin();
  }

  async begin() {
    try {
      await mic.open();
    } catch (e) {
      this.done = true;
      this.reject(e);
      return;
    }
    if (this.done) { mic.remove(null); return; } // cancelled while the mic was opening
    const rate = mic.rate;
    const preRoll = Math.ceil(600 / (4096 / rate * 1000)); // keep ~0.6 s before speech starts
    // Measure recorded samples: delayed browser callbacks must not manufacture a pause.
    let elapsed = 0, speechAt = null, lastVoice = 0, voiced = 0;

    this.handler = (data, rms) => {
      // A recording that starts during a reply must never contain Nexa's own voice.
      if (speaking.count || performance.now() < speaking.quietUntil) {
        this.chunks = [];
        speechAt = null;
        elapsed = lastVoice = voiced = 0;
        this.onLevel?.(0);
        return;
      }
      this.chunks.push(new Float32Array(data));
      this.onLevel?.(Math.min(1, rms * 14));
      const chunkMs = data.length / rate * 1000;
      const now = elapsed += chunkMs;
      const startLevel = Math.max(0.004, mic.noise * 2.5);

      if (speechAt === null) {
        // Learn the room's background level: follow it down quickly, up slowly.
        // Speech onset must not raise the background threshold for quieter words.
        if (rms <= startLevel) mic.noise = rms < mic.noise ? mic.noise * 0.7 + rms * 0.3 : mic.noise * 0.97 + rms * 0.03;
        if (this.chunks.length > preRoll) this.chunks.splice(0, this.chunks.length - preRoll);
        if (rms > startLevel) { speechAt = lastVoice = now; voiced = chunkMs; }
        else if (now > this.maxIdleMs) this.cancel();
        return;
      }
      // A loud first word must not hide a softly spoken end of the sentence.
      if (rms > Math.max(0.002, mic.noise * 1.5)) { lastVoice = now; voiced += chunkMs; }
      if (now - lastVoice > this.endSilenceMs) {
        if (voiced < this.minVoicedMs) { speechAt = null; voiced = 0; return; } // a click or cough
        this.stop();
      } else if (now - speechAt > this.maxSpeechMs) {
        this.stop({ truncated: true });
      }
    };
    mic.add(this.handler);
  }

  /** Finish now and keep what was heard. */
  stop({ truncated = false } = {}) {
    const pcm = toPcm16(this.chunks, mic.rate);
    pcm.truncated = truncated;
    this.finish(pcm);
  }
  /** Finish now and discard everything. */
  cancel() { this.finish(null); }

  finish(value) {
    if (this.done) return;
    this.done = true;
    if (this.handler) mic.remove(this.handler);
    this.onLevel?.(0);
    this.resolve(value);
  }
}

/**
 * The phrase as 16 kHz, 16-bit PCM for Whisper. A windowed-sinc low-pass filter removes what
 * 16 kHz can't hold before resampling; without it, hiss above 8 kHz folds back over the speech.
 */
function toPcm16(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const x = new Float32Array(len);
  let offset = 0;
  for (const c of chunks) { x.set(c, offset); offset += c.length; }
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(len / ratio));
  const clip = (v) => Math.max(-1, Math.min(1, v)) * 0x7fff;
  if (ratio <= 1) { for (let i = 0; i < out.length; i++) out[i] = clip(x[Math.floor(i * ratio)]); return out; }
  // Filter taps for 64 fractional positions between input samples, computed once.
  const fc = 0.45 / ratio, half = Math.ceil(10 * ratio), taps = 2 * half, steps = 64;
  const table = new Float32Array((steps + 1) * taps);
  for (let p = 0; p <= steps; p++) {
    for (let k = 0; k < taps; k++) {
      const d = p / steps + half - 1 - k; // distance from this tap to the output sample
      if (Math.abs(d) >= half) continue;
      const sinc = d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
      table[p * taps + k] = sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / half));
    }
  }
  for (let i = 0; i < out.length; i++) {
    const t = i * ratio, c = Math.floor(t), row = Math.round((t - c) * steps) * taps, first = c - half + 1;
    let s = 0;
    for (let k = Math.max(0, -first); k < taps && first + k < len; k++) s += x[first + k] * table[row + k];
    out[i] = clip(s);
  }
  return out;
}

/**
 * quality "fast" checks phrases for her name; "accurate" re-reads phrases meant for her.
 * purpose ("wake", "request", "mic"…) only labels the server's log line.
 */
async function transcribe(pcm, purpose = "", quality = "fast") {
  if (!pcm || !pcm.length) return { text: "", pitch: null };
  if (pcm.truncated) return { text: "", pitch: null, retry: true, reason: "too_long" };
  const r = await fetch(`/api/transcribe?for=${purpose}&q=${quality}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: pcm, // send just this view, including when it is a slice of a recording
  });
  if (!r.ok) throw new Error("transcribe failed");
  const res = await r.json();
  return { text: res.text || "", pitch: res.pitch || null, retry: !!res.retry, owner: res.owner || "", reason: res.reason || "" };
}

/* ---------- Drawing helpers shared by the orbs and the emblem ---------- */

// Nexa's colors: mint, emerald, and aqua while she listens.
const MINT = [150, 240, 200], EMERALD = [16, 150, 90], AQUA = [100, 235, 215];
// Nexa's icon, shown in the corner emblem while she speaks.
const NEXA_LOGO = new Image();
NEXA_LOGO.src = "/static/nexa-mark.png?v=3";
const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a))})`;
const mixColor = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

/** A four-point star with a soft glow, like the three stars in Nexa's icon. */
function drawStar(g, x, y, size, alpha) {
  g.save();
  g.translate(x, y);
  g.fillStyle = `rgba(236, 255, 245, ${alpha})`;
  g.shadowColor = rgba(MINT, alpha);
  g.shadowBlur = size * 1.2;
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, len = k % 2 ? size * 0.16 : size;
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/* ---------- Nexa's flat orb: used where WebGL (and so the 3D orb in orb3d.js) isn't available ---------- */

class Orb {
  /** compact: the small orb on the welcome screen. anchor: the element it sits on. */
  constructor(canvas, { compact = false, anchor = null, world = false } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.compact = compact;
    this.world = world;
    this.anchor = anchor || canvas;
    this.mode = "idle";
    this.level = 0;
    this.input = 0;
    this.t = 0;
    this.listenAmt = 0;
    this.thinkAmt = 0;
    this.speakAmt = 0;
    this.intro = 1;
    this.pulses = [];
    this.waveSource = null; // () => Float32Array of recent audio samples, or null
    this.running = false;
    this.frame = this.frame.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    if (this.anchor !== canvas) new ResizeObserver(() => this.resize()).observe(this.anchor);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    const spot = this.anchor.getBoundingClientRect();
    this.cx = (spot.left + spot.width / 2 - rect.left) * this.dpr;
    this.cy = (spot.top + spot.height / 2 - rect.top) * this.dpr;
    this.size = Math.min(spot.width, spot.height) * this.dpr;
  }

  setMode(mode) { this.mode = mode; }
  setLevel(v) { this.input = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  /** A ring of light that ripples outward. */
  pulse(strength = 1) { if (!REDUCED) this.pulses.push({ r: 0.5, a: 0.3 * strength }); }

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
    this.intro = Math.min(1, this.intro + dt / 0.9);
    for (const p of this.pulses) { p.r += dt * 0.8; p.a -= dt * 0.6; }
    this.pulses = this.pulses.filter((p) => p.a > 0);
    if (this.size) this.draw();
    this.raf = requestAnimationFrame(this.frame);
  }

  draw() {
    const { g, t, dpr, cx, cy } = this;
    const R = this.size * 0.48 * (this.world ? 1.25 : 1) * (0.88 + 0.12 * (1 - Math.pow(1 - this.intro, 3)));
    const L = this.level, think = this.thinkAmt, ice = mixColor(MINT, AQUA, this.listenAmt);
    const S = R * (this.compact ? 0.62 : 0.53) * (1 + 0.028 * L + 0.007 * Math.sin(t * 0.9));
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.globalAlpha = Math.min(1, this.intro * 1.6);

    // Aura.
    let grad = g.createRadialGradient(cx, cy, S * 0.9, cx, cy, S * 2.3);
    grad.addColorStop(0, rgba(ice, 0.3 + 0.4 * L + 0.1 * think));
    grad.addColorStop(1, rgba(EMERALD, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, S * 2.3, 0, TAU);
    g.fill();

    // Two tilted orbits: their far halves first (behind the glass), near halves after it.
    const turn = t * (0.05 + 0.15 * think);
    const orbits = [[1.43, 0.32, 2.2 + turn, ice, 1], [1.58, 0.42, 4.4 - turn * 0.7, EMERALD, 0.4]];
    const orbit = ([rad, squash, rot, color, bright], near) => {
      g.strokeStyle = rgba(color, (near ? 0.9 : 0.22) * bright);
      g.lineWidth = 1.4 * dpr;
      g.beginPath();
      g.ellipse(cx, cy, S * rad, S * rad * squash, rot, near ? 0 : Math.PI, near ? Math.PI : TAU);
      g.stroke();
    };
    orbits.forEach((o) => orbit(o, false));

    // The glass: deep green inside, emerald toward the edge, and a bright mint rim.
    grad = g.createRadialGradient(cx - S * 0.25, cy - S * 0.3, S * 0.05, cx, cy, S);
    grad.addColorStop(0, "rgba(18, 84, 58, 1)");
    grad.addColorStop(0.55, "rgba(6, 34, 24, 1)");
    grad.addColorStop(0.92, "rgba(16, 80, 54, 1)");
    grad.addColorStop(1, rgba(ice, 1));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, S, 0, TAU);
    g.fill();
    g.save();
    g.strokeStyle = rgba(ice, 0.85 + 0.15 * L);
    g.lineWidth = S * 0.05;
    g.shadowColor = rgba(ice, 1);
    g.shadowBlur = S * (0.25 + 0.3 * L);
    g.beginPath();
    g.arc(cx, cy, S * 0.975, 0, TAU);
    g.stroke();
    g.restore();

    // The three stars from her icon, lower left to upper right, joined by a faint line.
    const tw = t * (2 + 3 * think);
    const belt = [[-0.38, 0.27, 0.22, 0], [0.02, -0.02, 0.3, 2.1], [0.38, -0.3, 0.24, 4.2]];
    g.strokeStyle = rgba(ice, 0.35);
    g.lineWidth = dpr;
    g.beginPath();
    g.moveTo(cx + belt[0][0] * S, cy + belt[0][1] * S);
    g.lineTo(cx + belt[2][0] * S, cy + belt[2][1] * S);
    g.stroke();
    for (const [x, y, size, phase] of belt) {
      drawStar(g, cx + x * S, cy + y * S, size * S * (1 + 0.4 * L), 0.75 + 0.25 * Math.sin(tw + phase));
    }
    orbits.forEach((o) => orbit(o, true));

    // Your voice (while she listens) or hers (while she speaks) as a soft ring around the orb.
    const wave = this.waveSource?.();
    const waveAmt = Math.max(this.listenAmt, this.speakAmt);
    if (wave && waveAmt > 0.05) {
      const N = 120, step = wave.length / N;
      g.strokeStyle = rgba(ice, 0.8 * waveAmt);
      g.lineWidth = 1.6 * dpr;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const idx = i % N, a0 = Math.floor(idx * step), a1 = Math.max(a0 + 1, Math.floor((idx + 1) * step));
        let s = 0;
        for (let j = a0; j < a1; j++) s += wave[j] || 0;
        const rr = S * 1.12 + (s / (a1 - a0)) * R * (this.compact ? 0.2 : 0.3), ang = (i / N) * TAU;
        g[i ? "lineTo" : "moveTo"](cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      g.stroke();
    }

    for (const p of this.pulses) {
      g.strokeStyle = rgba(ice, p.a);
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(cx, cy, p.r * R, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

/* ---------- Nexa's emblem: her icon, shown in the corner while she speaks ---------- */

class Emblem {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.visible = false;
    this.running = false;
    this.t = 0;
    this.level = 0;
    this.flash = 0;
    this.ripples = []; // rings that spread from the icon on each syllable
    this.loud = false;
    this.frame = this.frame.bind(this);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const size = Math.round(rect.width * Math.min(window.devicePixelRatio || 1, 2));
    if (size === this.size) return;
    this.size = this.canvas.width = this.canvas.height = size;
  }

  show() {
    if (!this.visible) this.flash = 1;
    this.visible = true;
    this.canvas.classList.add("show");
    clearTimeout(this.stopTimer);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  hide() {
    this.visible = false;
    this.canvas.classList.remove("show");
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => { if (!this.visible) this.running = false; }, 800);
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!REDUCED) this.t += dt;
    const target = audio.level();
    this.level += (target - this.level) * (target > this.level ? 0.45 : 0.1);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    // A ripple each time her voice rises past a threshold (roughly once per syllable).
    if (!REDUCED && this.level > 0.32 && !this.loud && this.t - (this.lastRipple || 0) > 0.22) {
      this.ripples.push({ r: 0.25, a: 0.75 });
      this.lastRipple = this.t;
    }
    this.loud = this.level > 0.32;
    for (const p of this.ripples) { p.r += dt * 0.9; p.a -= dt * 1.1; }
    this.ripples = this.ripples.filter((p) => p.a > 0 && p.r < 1);
    this.resize();
    if (this.size) this.draw();
    requestAnimationFrame(this.frame);
  }

  draw() {
    const { g, size } = this;
    const c = size / 2, R = size * 0.46, L = this.level, F = this.flash;
    g.clearRect(0, 0, size, size);
    g.globalCompositeOperation = "lighter";

    // Glow behind the icon swells with her voice and flashes when she starts.
    const glowR = R * (0.75 + 0.25 * L + 0.3 * F);
    const grad = g.createRadialGradient(c, c, R * 0.3, c, c, glowR);
    grad.addColorStop(0, rgba(MINT, 0.55 + 0.3 * L));
    grad.addColorStop(1, rgba(EMERALD, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, glowR, 0, TAU);
    g.fill();

    for (const p of this.ripples) {
      g.strokeStyle = rgba(MINT, p.a);
      g.lineWidth = Math.max(1, size / 90);
      g.beginPath();
      g.arc(c, c, R * p.r, 0, TAU);
      g.stroke();
    }
    g.globalCompositeOperation = "source-over";

    // Nexa's icon, breathing with her voice.
    if (NEXA_LOGO.complete && NEXA_LOGO.naturalWidth) {
      const s = R * 1.5 * (1 + 0.06 * L + 0.08 * F);
      g.drawImage(NEXA_LOGO, c - s / 2, c - s / 2, s, s);
    }
  }
}

const emblem = new Emblem(els.emblem);
// The 3D orb (orb3d.js) where WebGL works; the flat one otherwise.
const ORB_3D = typeof Orb3D !== "undefined" && Orb3D.probe();
report("orb", ORB_3D ? { kind: "3d" } : { kind: "flat", problem: typeof Orb3D !== "undefined" ? Orb3D.problem : "orb3d.js missing" });
const makeOrb = (canvas, options) => (ORB_3D ? new Orb3D(canvas, options) : new Orb(canvas, options));
// In a voice session the orb's world fills the screen; the orb itself sits on #orbSpot.
const orb = makeOrb(els.orb, { anchor: els.orbSpot, world: true });
orb.waveSource = () => (orb.mode === "speaking" ? audio.wave() : orb.mode === "listening" ? mic.last : null);
const heroOrb = makeOrb(els.heroOrb, { compact: true });
heroOrb.waveSource = () => (wake.enabled ? mic.last : null);

/* ---------- Magicules: drifting motes of light behind the page ---------- */

class Magicules {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.energy = 0;
    this.last = 0;
    this.dark = matchMedia("(prefers-color-scheme: dark)");
    this.frame = this.frame.bind(this);
    addEventListener("resize", () => this.resize());
    this.resize();
    const count = REDUCED ? 0 : Math.round(Math.min(45, (innerWidth * innerHeight) / 32000));
    this.motes = Array.from({ length: count }, () => this.spawn(true));
    if (count) requestAnimationFrame(this.frame);
  }

  resize() {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
  }

  spawn(anywhere) {
    return {
      x: Math.random(), y: anywhere ? Math.random() : 1.05, r: 0.4 + Math.random() * 0.9,
      vy: 0.008 + Math.random() * 0.02, sway: 6 + Math.random() * 18, phase: Math.random() * TAU,
      tw: 0.8 + Math.random() * 2, teal: Math.random() < 0.22,
    };
  }

  frame(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    requestAnimationFrame(this.frame);
    if (document.hidden || !els.live.hidden) return; // not visible: save power
    // They stir and brighten while someone talks to her or she speaks.
    const target = Math.max(audio.source ? audio.level() : 0, state.micLevel || 0);
    this.energy += (target - this.energy) * (target > this.energy ? 0.2 : 0.03);
    const { g, canvas } = this;
    const W = canvas.width, H = canvas.height, boost = 1 + this.energy * 3, dark = this.dark.matches;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (const m of this.motes) {
      m.y -= m.vy * dt * boost;
      m.phase += dt * m.tw;
      if (m.y < -0.05) Object.assign(m, this.spawn(false));
      const x = m.x * W + Math.sin(m.phase * 0.5) * m.sway, y = m.y * H;
      const alpha = (dark ? 0.2 : 0.25) * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(m.phase))) * (0.7 + this.energy);
      const color = m.teal ? (dark ? AQUA : [13, 138, 128]) : (dark ? MINT : [10, 135, 84]);
      g.fillStyle = rgba(color, alpha);
      g.beginPath();
      g.arc(x, y, m.r * (1 + this.energy * 0.6), 0, TAU);
      g.fill();
      if (dark && m.r > 1.8) { // a soft halo on the bigger ones
        g.fillStyle = rgba(color, alpha * 0.22);
        g.beginPath();
        g.arc(x, y, m.r * 4, 0, TAU);
        g.fill();
      }
    }
    g.globalCompositeOperation = "source-over";
  }
}
new Magicules(els.magicules);

function showWelcome(show) {
  els.welcome.hidden = !show;
  if (show) updateGreeting();
  if (show) heroOrb.start({ intro: true });
  else heroOrb.stop();
}

/* ---------- Chat ---------- */

function nearBottom() {
  return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 140;
}
function scrollDown(force) {
  if (force || nearBottom()) els.chat.scrollTop = els.chat.scrollHeight;
}

function addUserMessage(text) {
  const row = document.createElement("div");
  row.className = "msg user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.append(bubble);
  els.messages.append(row);
  scrollDown(true);
}

function addAssistantMessage() {
  const row = document.createElement("div");
  row.className = "msg assistant thinking";
  // Until her first words arrive: a small turning magic circle and "Analyzing".
  row.innerHTML = '<div class="avatar"></div><div class="content"><div class="body">' +
    '<div class="analyzing"><span class="mini-circle"></span><span class="en-label">Analyzing</span></div></div></div>';
  els.messages.append(row);
  scrollDown(true);
  return row;
}

function renderSources(sources) {
  const wrap = document.createElement("div");
  wrap.className = "sources";
  sources.forEach((s, i) => {
    if (!safeUrl(s.url)) return;
    let host = "";
    try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
    const a = document.createElement("a");
    a.className = "source";
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `<span class="src-top"><span class="num">${i + 1}</span>${escapeHtml(host)}</span>` +
      `<span class="src-title">${escapeHtml(s.title || host)}</span>`;
    wrap.append(a);
  });
  return wrap;
}

function addMessageTools(row, text, brain = "") {
  const tools = document.createElement("div");
  tools.className = "msg-tools";
  tools.innerHTML = `
    <button class="icon-btn" data-act="speak" title="Read aloud" aria-label="Read aloud"><svg class="i" viewBox="0 0 24 24"><path d="M11 5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5l4.5 4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/></svg></button>
    <button class="icon-btn" data-act="copy" title="Copy" aria-label="Copy"><svg class="i" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/></svg></button>`;
  tools.insertAdjacentHTML("beforeend",
    `<button class="icon-btn" data-act="retry" title="Try again" aria-label="Try again"><svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20.2 4v5h-5"/></svg></button>`);
  tools.addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "copy") navigator.clipboard?.writeText(text).then(() => toast("Copied"));
    if (act === "speak") sayLine(text);
    if (act === "retry") retryLast(row);
  });
  if (brain) {
    // Which brain answered: "✦ Gemini …" online, or "gemma3:1b · on this PC".
    tools.insertAdjacentHTML("beforeend", `<span class="brain" title="Answered by">${escapeHtml(brain)}</span>`);
  }
  row.querySelector(".content").append(tools);
}

/** Asks the last question again (only offered on her newest reply). */
function retryLast(row) {
  if (state.busy || row !== els.messages.lastElementChild) return;
  const [question, answer] = state.history.slice(-2);
  if (question?.role !== "user" || answer?.role !== "assistant") return;
  state.history.splice(-2, 2);
  row.previousElementSibling?.remove();
  row.remove();
  ask(question.content);
}

function setBusy(busy) {
  state.busy = busy;
  els.send.classList.toggle("busy", busy);
  els.send.title = busy ? "Stop" : "Send";
  updateSendEnabled();
}
function updateSendEnabled() {
  els.send.disabled = !state.busy && !els.input.value.trim();
}

/**
 * Sends one user turn and streams the reply into the chat.
 * Resolves with the reply text after it has finished and, if spoken, been read aloud.
 */
async function ask(text, { voice = false, speak = false, onText, onSpeaking, onStatus } = {}) {
  text = text.trim();
  if (!text || state.busy) return "";
  showWelcome(false);
  stopSpeaking();
  addUserMessage(text);
  state.history.push({ role: "user", content: text });

  const row = addAssistantMessage();
  const content = row.querySelector(".content");
  const body = row.querySelector(".body");
  const ctrl = new AbortController();
  state.abort = ctrl;
  setBusy(true);

  const speaker = (speak || voice || state.speakReplies) ? new SentenceSpeaker() : null;
  if (speaker) { speaker.onstart = onSpeaking; state.speaker = speaker; }

  let reply = "", error = "", frame = 0, sources = [], statusEl = null, brain = "";
  const paint = () => {
    frame = 0;
    const stick = nearBottom();
    body.innerHTML = renderMarkdown(reply, sources);
    if (stick) scrollDown(true);
  };

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: els.model.value, messages: state.history, voice, web: state.web, address: addressWord(),
        prefer: state.prefer,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) throw new Error("bad response");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.error) { error = ev.error; continue; }
        if (ev.status) {
          statusEl = document.createElement("div");
          statusEl.className = "search-status" + (ev.status.startsWith("Searching") ? "" : " done");
          statusEl.innerHTML = `<span class="spin"></span><span>${escapeHtml(ev.status)}</span>`;
          content.prepend(statusEl);
          const analyzing = body.querySelector(".analyzing");
          if (analyzing && ev.status.startsWith("Searching")) {
            analyzing.querySelector(".en-label").textContent = "Searching the web";
          }
          onStatus?.(ev.status);
          continue;
        }
        if (ev.sources) { sources = ev.sources; continue; }
        if (ev.brain) { brain = ev.brain; continue; }
        reply += ev.t;
        row.classList.remove("thinking");
        row.classList.add("streaming");
        speaker?.push(ev.t);
        onText?.(reply);
        if (!frame) frame = requestAnimationFrame(paint);
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") error = "Couldn't reach Nexa's server. Is it still running?";
  }

  if (frame) cancelAnimationFrame(frame);
  row.classList.remove("thinking", "streaming");
  state.abort = null;
  setBusy(false);
  if (statusEl && sources.length) {
    statusEl.classList.add("done");
    statusEl.lastChild.textContent = `Searched the web · ${sources.length} source${sources.length > 1 ? "s" : ""}`;
  }

  if (reply) {
    paint();
    row.classList.add("revealed"); // a soft light sweeps the finished reply
    if (sources.length) body.after(renderSources(sources));
    // brain and sources are kept so saved chats show them again; the server only reads role/content.
    state.history.push({ role: "assistant", content: reply, brain, sources });
    addMessageTools(row, reply, brain);
    persistChat();
  } else {
    state.history.pop(); // drop the unanswered turn so a retry starts clean
  }
  if (error) {
    row.classList.add("error");
    if (!reply) body.innerHTML = ""; // remove the "Analyzing" indicator
    body.insertAdjacentHTML("beforeend", `<p>${escapeHtml(error)}</p>`);
  } else if (!reply) {
    row.remove();
  }

  if (speaker) {
    speaker.end();
    await speaker.finished;
    if (state.speaker === speaker) state.speaker = null;
  }
  return reply;
}

function stopGeneration() {
  state.abort?.abort();
  stopSpeaking();
}

/* ---------- Mic button: speak one message ---------- */

let micListener = null, micTranscribing = false;
async function toggleMic() {
  if (ownerEnrollment.active || !requireOwner()) return;
  const ownerGeneration = ownerEnrollment.id;
  if (micListener) return micListener.stop();
  if (state.busy || session.on || micTranscribing) return;
  stopSpeaking();
  const listener = micListener = new Listener({ maxIdleMs: 8000 });
  wake.listener?.cancel(); // the wake loop pauses while the mic button is in use
  els.mic.classList.add("recording");
  els.input.placeholder = "Listening… click the mic again when you're done";
  let pcm = null;
  try {
    pcm = await listener.result;
  } catch {
    els.input.placeholder = "Microphone blocked: allow it in the browser's address bar";
    return;
  } finally {
    micListener = null;
    els.mic.classList.remove("recording");
    // Keep background wake checks paused until transcription and the reply finish.
    micTranscribing = !!pcm;
    if (!pcm && wake.enabled) wakeLoop();
  }
  if (!pcm) { els.input.placeholder = "Didn't catch that. Try again?"; return; }
  els.input.placeholder = "Transcribing…";
  try {
    const { text, pitch, owner, reason } = await transcribe(pcm, "mic", state.hearing);
    if (ownerEnrollment.active || ownerGeneration !== ownerEnrollment.id) return;
    if (owner && owner !== "matched") {
      els.input.placeholder = ownerMessage(owner);
      return;
    }
    noteVoice(pitch);
    els.input.placeholder = PLACEHOLDER;
    const hit = text ? matchWake(text) : null;
    if (hit && !hit.rest) { await startSession("wake"); return; }
    if (text) await ask(hit ? hit.rest : text, { voice: true });
    else els.input.placeholder = reason === "too_long"
      ? "That was too long. Please try a shorter request."
      : "Didn't catch that clearly. Please say it again.";
  } catch {
    els.input.placeholder = "Speech recognition failed. Is the server running?";
  } finally {
    micTranscribing = false;
    if (wake.enabled) wakeLoop();
  }
}

/* ---------- "Hey Nexa" wake word ---------- */

// Background listening needs her name, and it only counts when it's said *to* her:
// after a greeting ("Hey Nexa"), at the start ("Nexa, ..." / "Nexa open Word"), or at the
// end ("..., Nexa?" / "turn up the volume Nexa"). "I read about Nexa today" never wakes her.
const GREETING_RE = /^(?:he+y+|hi+|ha+y|hei|hel+o|ok(?:ay)?|oi|yo|a|ay|eh)$/i;
const END_RE = /^(?:ok(?:ay)?[\s,]*)?(?:stop|goodbye|good bye|bye(?: bye)?|that'?s all|that is all|never ?mind|cancel|dismiss(?:ed)?|go to sleep|thank you,? that'?s all)[\s.!]*$/i;
// Words that start a request right after her name ("Nexa what time is it", "Nexa open Word").
const LEAD_RE = /^(?:what'?s?|who'?s?|how|when|where|why|which|can|could|would|will|should|please|tell|open|play|search|set|turn|show|give|find|read|remind|call|help|i|are|do|does|did|stop|start|make|write|explain|translate|check|close|launch|run|go|pause|resume|skip|next|mute|unmute|lock|volume|increase|decrease|raise|lower|switch|shut|restart|look|google|say|define|calculate|convert)$/i;
// Words that make her name part of a sentence about her rather than a call ("about Nexa", "buy a Nexa").
const MENTION_RE = /^(?:about|to|with|from|of|for|by|at|on|in|into|the|a|an|this|that|my|your|our|their|his|her|called|named|like|than|and|or|is|was|meet|use|using)$/i;
// Polite words that may follow her name at the end ("open Spotify Nexa please").
const POLITE_RE = /^(?:please|thanks|thank|you|now)$/i;
// Her name, and the spellings Whisper may write for it with different accents ("Nexxa", "Neksa").
const isName = (word) => /^(?:nexa|nexxa|neksa|nexah|nexar|nexia)(?:'?s)?$/i.test(word);
// "Nex-a" / "Neks a" -> "Nexa" (but not "Next, a", which is a real phrase).
const joinName = (text) => text.replace(/\bne(?:x|ks)[\s-]+a(h?)\b/gi, "Nexa$1");
const isGreetingOnly = (text) => { const w = text.match(/[A-Za-z']+/g); return w?.length === 1 && GREETING_RE.test(w[0]); };

/**
 * Nexa answers when she is spoken to by name. Returns what to answer, or null:
 *   "Hey Nexa, what time is it?" / "Nexa, what time is it?" -> { rest: "what time is it?" }
 *   "Hey Nexa" / "Nexa?"                                    -> { rest: "" } (she says "Yes, Sir?")
 *   "What time is it, Nexa?" / "open Spotify Nexa please"     -> { rest: "What time is it?" } / { rest: "open Spotify please" }
 */
function matchWake(text) {
  text = joinName(text);
  const words = [...text.matchAll(/[A-Za-z']+/g)];
  // Only her name, maybe said more than once ("Nexa… Nexa!"): she answers "Yes, Sir?" and
  // listens for the request.
  if (words.some((w) => isName(w[0])) && words.every((w) => isName(w[0]) || GREETING_RE.test(w[0]))) return { rest: "" };
  const after = (w) => text.slice(w.index + w[0].length).replace(/^[\s,.!?;:-]+/, "").trim();
  // After a greeting. "A", "ay" and "eh" (how Whisper often writes "Hey") count only at the start,
  // so "I'd buy a Nexa" isn't a call.
  for (let i = 0; i + 1 < words.length; i++) {
    if (GREETING_RE.test(words[i][0]) && isName(words[i + 1][0]) && (i === 0 || !/^(?:a|ay|eh)$/i.test(words[i][0]))) {
      return { rest: after(words[i + 1]) };
    }
  }
  if (words.length && isName(words[0][0])) {
    const tail = text.slice(words[0].index + words[0][0].length);
    if (!tail.trim() || /^[,.!?-]/.test(tail) || (words[1] && LEAD_RE.test(words[1][0]))) return { rest: after(words[0]) };
  }
  // At the end, maybe followed by "please" or "thanks". Without a comma before it, the word before
  // must not make it a mention ("talking about Nexa").
  let k = words.length - 1;
  while (k > 0 && POLITE_RE.test(words[k][0])) k--;
  if (k > 0 && isName(words[k][0])) {
    const before = text.slice(0, words[k].index);
    if (/,\s*$/.test(before) || !MENTION_RE.test(words[k - 1][0])) {
      const request = before.replace(/[\s,]+$/, "");
      const tail = text.slice(words[k].index + words[k][0].length).replace(/^[\s,]+/, "").trim();
      return { rest: /^[.!?]*$/.test(tail) ? request + (tail || ".") : `${request} ${tail}` };
    }
  }
  return null;
}

const wake = { enabled: false, listener: null, running: false, triggering: false, checking: 0, greeting: null, generation: 0 };

/** Two recordings as one, with a short silence between. */
function joinPcm(a, b) {
  const gap = 3200; // 0.2 s at 16 kHz
  const out = new Int16Array(a.length + gap + b.length);
  out.set(a);
  out.set(b, a.length + gap);
  out.truncated = !!(a.truncated || b.truncated) || out.length > 16000 * 40;
  return out;
}

function setWakeLevel(v) {
  els.wakeBtn.style.setProperty("--lvl", v.toFixed(2));
  heroOrb.setLevel(v);
  state.micLevel = v; // the magicules stir with your voice
}

function setWake(on) {
  wake.generation++;
  wake.enabled = on;
  savePref("wake", on);
  els.wakeBtn.setAttribute("aria-pressed", String(on));
  heroOrb.setMode(on ? "listening" : "idle");
  setFootnote();
  report("wake", { on });
  if (on) wakeLoop();
  else wake.listener?.cancel();
}

/** Listens in the background, phrase by phrase; answers only phrases with her name. */
async function wakeLoop() {
  if (wake.running) return;
  wake.running = true;
  try {
    while (wake.enabled && state.owner.enrolled && !ownerEnrollment.active && !session.on && !micListener && !micTranscribing) {
      // Allow a natural pause after her name and enough time for the complete request.
      const listener = wake.listener = new Listener({
        onLevel: setWakeLevel, endSilenceMs: 1800, minVoicedMs: 350, maxSpeechMs: 35000,
      });
      let pcm;
      try {
        pcm = await listener.result;
      } catch (e) {
        setWake(false);
        showBanner(e.name === "NotAllowedError"
          ? "Microphone blocked. Click the camera/mic icon in the address bar, allow the microphone, then click “Hey Nexa”."
          : "No microphone found. Plug one in or check Windows sound settings, then click “Hey Nexa”.");
        return;
      }
      wake.listener = null;
      // Skip phrases heard while Nexa is talking or the mic button is in use.
      if (!pcm || !wake.enabled || session.on || micListener || micTranscribing || state.speaker) continue;
      // In constant chatter (TV, a call), don't build a backlog of phrases to check.
      if (wake.checking >= 2) { report("wake-skip", { reason: "busy" }); continue; }
      // "Hey" … pause … "Nexa": hear both together, so her name isn't a lone word without context.
      if (wake.greeting && performance.now() - wake.greeting.at < 5000) pcm = joinPcm(wake.greeting.pcm, pcm);
      wake.greeting = null;
      checkWakePhrase(pcm); // transcribe in the background and keep listening meanwhile
    }
  } finally {
    wake.running = false;
    wake.listener = null;
  }
}

async function checkWakePhrase(pcm) {
  const generation = wake.generation;
  let text = "", pitch = null;
  wake.checking++;
  // With Hearing set to Accurate, the bigger model also listens for her name: the fast one
  // often mishears real voices ("Hey Nexa" → "Hey, see you", "A C").
  const quality = state.hearing === "accurate" ? "accurate" : "fast";
  try { ({ text, pitch } = await transcribe(pcm, "wake", quality)); } catch { return; } finally { wake.checking--; }
  if (!text || generation !== wake.generation) return;
  const hit = matchWake(text);
  if (hit) noteVoice(pitch); // the person who called her decides Sir or Ma'am
  report("wake-check", { text, matched: !!hit });
  if (!hit) {
    if (isGreetingOnly(text)) wake.greeting = { pcm, at: performance.now() }; // her name may come next
    setFootnote(`Heard “${text.slice(0, 80)}”. Say “Nexa” to call me.`);
    return;
  }
  if (!wake.enabled || ownerEnrollment.active || session.on || micListener || micTranscribing || state.speaker || state.busy || wake.triggering) return;
  wake.triggering = true;
  wake.listener?.cancel();
  setFootnote();
  sfx.heard();
  // Already heard with the accurate model? Then there's nothing to re-read.
  const reread = quality === "fast" ? pcm : null;
  try { await startSession("wake", { command: hit.rest, pcm: reread }); } finally { wake.triggering = false; }
}

/* ---------- Voice session: talk with Nexa ---------- */

const session = { on: false, id: 0, mode: "", listener: null, lingerTimer: 0 };

function setOrb(mode, label) {
  orb.setMode(mode);
  els.live.dataset.mode = mode;
  $("orbCaption").textContent = {
    idle: "I'm here. Take your time.",
    listening: "Go ahead. I'm listening.",
    thinking: "Connecting the dots…",
    speaking: "Tap the orb whenever you want to jump in.",
  }[mode] || "I'm here. Take your time.";
  sfx.analyze(mode === "thinking");
  els.liveState.textContent = label.toUpperCase();
  els.liveState.classList.toggle("busy", mode === "thinking");
}
function setSubs(you, nexa) {
  if (you !== undefined) els.subYou.textContent = you;
  if (nexa !== undefined) els.subNexa.textContent = nexa;
}

/**
 * mode "wake": she heard her name. She answers that one request, then goes back
 * to waiting, so the next request needs her name again. If only her name was
 * said, she replies "Yes, Sir?" (or Ma'am…) and takes the next sentence as the request.
 * mode "live" (Talk button): a conversation until End; each spoken turn is for her.
 *
 * pcm: the recording that contained her name, re-read with the accurate model.
 */
async function startSession(mode, { command = "", pcm = null } = {}) {
  if (ownerEnrollment.active || !requireOwner()) return;
  stopGeneration();
  micListener?.cancel();
  wake.listener?.cancel();
  clearTimeout(session.lingerTimer);
  while (state.busy) await sleep(30); // let a stopped reply finish cleaning up
  const id = ++session.id;
  const alive = () => session.on && session.id === id;
  Object.assign(session, { on: true, mode, listener: null });
  document.body.classList.add("in-live");
  clearTimeout(hideTimer);
  els.live.classList.remove("closing");
  els.live.hidden = false; // the CSS "summon" animation opens it from the center
  orb.start({ intro: true });
  heroOrb.stop(); // hidden behind the session; only one orb draws at a time
  sfx.summon();
  setOrb("idle", "Linked");
  setSubs("", "");

  if (mode === "wake") {
    if (command && pcm && state.hearing === "accurate") {
      setSubs(`“${command}”`, "");
      setOrb("thinking", "Listening closely");
      command = await reread(pcm);
      if (!alive()) return;
    }
    report("session", { mode, command });
    if (!command) {
      await acknowledge(alive);
      if (alive()) command = await listenForRequest(alive, 8000);
    }
    if (alive() && command) await handleRequest(command, alive);
    if (alive()) endSession({ linger: true });
    return;
  }

  report("session", { mode });
  setSubs("", "Speak naturally. You don't need to say my name. Say “goodbye” to finish.");
  while (alive()) {
    const request = await listenForRequest(alive, Infinity);
    if (!alive()) return;
    if (request === null) { endSession({ linger: true }); return; }
    if (request) await handleRequest(request, alive);
  }
}

/** A rejected accurate reading must never turn back into an actionable fast draft. */
async function reread(pcm) {
  try {
    const { text: better } = await transcribe(pcm, "request", "accurate");
    if (!better) return "";
    const hit = matchWake(better);
    return hit ? hit.rest : better;
  } catch {
    return "";
  }
}

/**
 * Listens for one request. Returns its text, "" if nothing was said (or, with needName, if it
 * wasn't said with her name), or null if the mic failed.
 */
async function listenForRequest(alive, maxIdleMs, needName = false) {
  while (alive()) {
    setOrb("listening", "Listening");
    const listener = session.listener = new Listener({ onLevel: (v) => orb.setLevel(v), maxIdleMs });
    let pcm;
    try {
      pcm = await listener.result;
    } catch {
      setOrb("idle", "Microphone unavailable");
      setSubs("", "Allow microphone access, then try again.");
      return null;
    } finally {
      session.listener = null;
    }
    if (!pcm || !alive()) return "";
    setOrb("thinking", "Analyzing");
    let text = "", reason = "";
    try {
      const heard = await transcribe(pcm, needName ? "talk" : "request", state.hearing);
      if (!alive()) return "";
      if (heard.owner && heard.owner !== "matched") {
        setSubs("", ownerMessage(heard.owner));
        if (["not_enrolled", "unavailable"].includes(heard.owner)) return null;
        return ""; // stay silent for a different speaker
      }
      text = heard.text;
      reason = heard.reason;
      noteVoice(heard.pitch);
    } catch {
      if (alive()) {
        setSubs("", "I couldn't transcribe that. Check the server, then try again.");
        await sleep(1000);
      }
      return "";
    }
    if (!alive()) return "";
    if (!text) {
      const message = reason === "too_long"
        ? "That was too long. Please try a shorter request."
        : "I didn't catch that clearly. Could you say it again?";
      setSubs("", message);
      await sayLine(message, undefined, { chime: false });
      continue;
    }
    const hit = matchWake(text);
    // Only her name: "Yes, Sir?", and the next sentence is for her even without it.
    if (hit && !hit.rest) { await acknowledge(alive); needName = false; continue; }
    if (hit || !needName) return hit ? hit.rest : text;
    report("talk-skip", { text });
    setSubs(`“${text}”`, "Say “Nexa” when it's for me.");
    return "";
  }
  return "";
}

async function handleRequest(command, alive) {
  if (END_RE.test(command)) {
    setSubs(`“${command}”`, "");
    setOrb("speaking", "Speaking");
    await sayLine(`Got it. ${titled("Talk to you later", ".")}`, (s) => setSubs(undefined, s), { chime: false });
    if (alive()) endSession();
    return;
  }
  await converse(command, alive);
}

/** "Yes, Sir?" — her answer when you only say her name. */
async function acknowledge(alive) {
  setOrb("speaking", "Speaking");
  const line = titled("Yes", "?");
  setSubs(undefined, line);
  if (state.tts || "speechSynthesis" in window) await sayLine(line, undefined, { chime: false });
  else sfx.heard();
  if (alive()) setSubs(undefined, "");
}

async function converse(text, alive) {
  setSubs(`“${text}”`, "");
  setOrb("thinking", "Analyzing");
  let spoke = false;
  const reply = await ask(text, {
    voice: true,
    onStatus: (s) => {
      if (!alive()) return;
      if (s.startsWith("Searching")) sfx.search();
      setOrb("thinking", s.startsWith("Searching") ? "Searching the web" : "Analyzing");
    },
    onSpeaking: (sentence) => {
      if (!alive()) return;
      if (!spoke) { spoke = true; orb.pulse(0.6); }
      setOrb("speaking", "Speaking");
      setSubs(undefined, sentence); // subtitles follow her voice, sentence by sentence
    },
  });
  // If she couldn't speak (voice unavailable), still show the answer as a subtitle.
  if (alive() && !spoke && reply) setSubs(undefined, cleanForSpeech(reply));
}

function interruptSession() {
  if (session.listener) return; // already listening
  stopGeneration();              // her answer stops; the session moves on
}

/** linger: keep her last words on screen a few seconds while she goes back to waiting. */
function endSession({ linger = false } = {}) {
  session.on = false;
  session.listener?.cancel();
  session.listener = null;
  clearTimeout(session.lingerTimer);
  if (linger) {
    setOrb("idle", "Standing by");
    session.lingerTimer = setTimeout(hideLive, 4000);
  } else {
    stopGeneration();
    hideLive();
  }
  if (wake.enabled) wakeLoop();
}

let hideTimer = 0;
/** Folds the voice screen back into the center, then hides it. */
function hideLive() {
  if (els.live.hidden) return;
  sfx.analyze(false);
  sfx.dismiss();
  els.live.classList.add("closing");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    els.live.hidden = true;
    els.live.classList.remove("closing");
    document.body.classList.remove("in-live");
    orb.stop();
    if (!els.welcome.hidden) heroOrb.start();
  }, 380);
}

/* ---------- Voice settings ---------- */

function setSeg(seg, value) {
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(value))));
}

async function loadVoices() {
  try {
    const v = await (await fetch("/api/voices")).json();
    const ids = v.voices.map((x) => x.id);
    els.voiceSel.replaceChildren(...v.voices.map((x) => new Option(x.label, x.id)));
    if (!ids.includes(state.voice)) state.voice = ids.includes(v.default) ? v.default : ids[0] || "";
    els.voiceSel.value = state.voice;
  } catch { /* server not ready; the default voice is used */ }
}

/** A line to show off the voice, in the current way of talking. */
const voiceSample = (long = false) => `${titled("Hey", "!")} ${long ? "I'm all set. What can I do for you?" : "This is how I sound."}`;

function voiceChanged() {
  clipCache.clear();
  warmLines();
  sayLine(voiceSample());
}

function openSettings(open = true, tab) {
  if (!open && ownerEnrollment.active) cancelEnrollment();
  els.settings.hidden = !open;
  els.settingsBtn.setAttribute("aria-expanded", String(open));
  if (open && tab) showSettingsTab(tab);
}
function showSettingsTab(name) {
  if (name !== "general" && ownerEnrollment.active) cancelEnrollment();
  els.settings.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  els.settings.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

/* Owner enrollment pauses all other listeners; samples live only in memory. */
const OWNER_PROMPTS = [
  "Hey Nexa, this is my voice. Please listen carefully when I speak to you.",
  "I would like to have a conversation. Tell me about something interesting today.",
  "Nexa, recognize my voice and answer me clearly. I am ready to talk with you.",
];
const ownerEnrollment = { active: false, busy: false, saving: false, samples: [], listener: null, id: 0 };

function ownerMessage(reason) {
  return {
    not_enrolled: "Enroll your voice in Settings > General before speaking to Nexa.",
    not_owner: "That voice didn't match your profile. Try again in a quiet room.",
    too_short: "Please say a complete sentence so I can check your voice.",
    unavailable: "Voice checking is unavailable. Run setup.ps1, then restart Nexa.",
  }[reason] || "I didn't catch that clearly. Please try again.";
}

function requireOwner() {
  if (state.owner.enrolled) return true;
  openSettings(true, "general");
  toast("Enroll your voice to enable spoken requests.");
  return false;
}

function renderOwner(message = "") {
  if (ownerEnrollment.active && !message) return;
  setFootnote();
  els.ownerState.textContent = message || (state.owner.enrolled
    ? "Voice enrolled. Spoken requests must match your profile."
    : "No voice enrolled. Spoken requests are paused until you enroll.");
  els.ownerRemove.hidden = !state.owner.enrolled || ownerEnrollment.active;
  els.ownerCancel.hidden = !ownerEnrollment.active;
  els.ownerCancel.disabled = ownerEnrollment.saving;
  els.ownerPrompt.hidden = !ownerEnrollment.active || ownerEnrollment.samples.length >= 3;
  if (!els.ownerPrompt.hidden) els.ownerPrompt.textContent = `Sample ${ownerEnrollment.samples.length + 1} of 3: “${OWNER_PROMPTS[ownerEnrollment.samples.length]}”`;
  els.ownerEnroll.textContent = ownerEnrollment.saving ? "Saving voice…"
    : ownerEnrollment.active ? `Record sample ${ownerEnrollment.samples.length + 1} of 3`
    : state.owner.enrolled ? "Enroll again" : "Enroll my voice";
  els.ownerEnroll.disabled = ownerEnrollment.busy;
}

function cancelEnrollment() {
  if (ownerEnrollment.saving) return; // the server is committing the profile; wait for its result
  ownerEnrollment.id++;
  ownerEnrollment.active = ownerEnrollment.busy = false;
  ownerEnrollment.listener?.cancel();
  ownerEnrollment.listener = null;
  ownerEnrollment.samples = [];
  renderOwner();
  if (wake.enabled) wakeLoop();
}

function pcmBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

els.ownerEnroll.addEventListener("click", async () => {
  if (ownerEnrollment.busy) return;
  const id = ownerEnrollment.id;
  const active = () => ownerEnrollment.id === id && ownerEnrollment.active;
  ownerEnrollment.busy = true;
  if (!ownerEnrollment.active) {
    ownerEnrollment.active = true;
    wake.generation++;
    wake.greeting = null;
    endSession();
    micListener?.cancel();
    wake.listener?.cancel();
    renderOwner("Preparing speaker recognition. The first setup downloads a 28 MB model…");
    try {
      const r = await fetch("/api/owner/prepare", { method: "POST" });
      const result = await r.json();
      if (!active()) return;
      if (!r.ok) throw new Error(result.error);
      state.owner = result;
      ownerEnrollment.busy = false;
      renderOwner("Read the sentence, then press Record. Speak in your normal voice and pause when finished.");
    } catch (e) {
      if (active()) { cancelEnrollment(); renderOwner(e.message || "Couldn't prepare speaker recognition."); }
    }
    return;
  }
  renderOwner("Listening… read the sentence aloud, then pause.");
  try {
    const listener = ownerEnrollment.listener = new Listener({ maxIdleMs: 15000, maxSpeechMs: 18000, endSilenceMs: 1600 });
    const pcm = await listener.result;
    if (!active()) return;
    ownerEnrollment.listener = null;
    if (!pcm || pcm.length < 16000 * 3) throw new Error("That sample was too short. Read the whole sentence and try again.");
    ownerEnrollment.samples.push(pcmBase64(pcm));
    if (ownerEnrollment.samples.length < 3) {
      ownerEnrollment.busy = false;
      renderOwner("Sample captured. Read the next sentence, then press Record.");
      return;
    }
    ownerEnrollment.saving = true;
    renderOwner("Checking that all three samples match…");
    const r = await fetch("/api/owner/enroll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples: ownerEnrollment.samples }),
    });
    const result = await r.json();
    ownerEnrollment.saving = false;
    if (!active()) return;
    if (!r.ok) { cancelEnrollment(); renderOwner(result.error || "Couldn't enroll your voice. Please try again."); return; }
    state.owner = result;
    cancelEnrollment();
    renderOwner("Your voice is enrolled. Use Talk, the mic, or say “Hey Nexa” with a complete request.");
  } catch (e) {
    if (!active()) return;
    ownerEnrollment.saving = false;
    ownerEnrollment.busy = false;
    if (ownerEnrollment.samples.length >= 3) ownerEnrollment.samples = [];
    renderOwner(e.name === "NotAllowedError" ? "Microphone blocked. Allow microphone access and try again." : e.message || "Couldn't record that sample.");
  }
});
els.ownerCancel.addEventListener("click", cancelEnrollment);
els.ownerRemove.addEventListener("click", async () => {
  els.ownerRemove.disabled = true;
  try {
    const r = await fetch("/api/owner", { method: "DELETE" });
    if (!r.ok) throw new Error("Couldn't remove your voice. Please try again.");
    state.owner = await r.json();
    wake.generation++;
    wake.greeting = null;
    wake.listener?.cancel();
    endSession();
    renderOwner("Voice profile removed. Spoken requests are paused until you enroll again.");
  } catch (e) { renderOwner(e.message); }
  finally { els.ownerRemove.disabled = false; }
});
els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openSettings(els.settings.hidden);
});
els.settings.addEventListener("click", (e) => { if (e.target === els.settings) openSettings(false); }); // the dark backdrop
$("settingsClose").addEventListener("click", () => openSettings(false));
// Quit Nexa: she runs without a console window, so this is how she stops.
$("quitBtn").addEventListener("click", async () => {
  wake.enabled = false; // stop listening without changing the saved setting
  wake.listener?.cancel();
  if (session.on) endSession();
  stopGeneration();
  try {
    await fetch("/api/quit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch { /* already stopped */ }
  window.close(); // closes her own window; a normal browser tab stays open and says so instead
  openSettings(false);
  const note = document.createElement("div");
  note.className = "stopped";
  note.textContent = "Nexa has stopped. Open her again from the Nexa shortcut.";
  document.body.append(note);
});
els.settings.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => showSettingsTab(t.dataset.tab)));
els.voiceSel.addEventListener("change", () => {
  state.voice = els.voiceSel.value;
  savePref("voiceNexa", state.voice);
  voiceChanged();
});
els.styleSeg.addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.v;
  if (!v) return;
  state.style = v;
  savePref("style", v);
  setSeg(els.styleSeg, v);
  voiceChanged();
});
els.echoSeg.addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.v;
  if (v === undefined) return;
  state.echo = +v;
  savePref("echo", state.echo);
  setSeg(els.echoSeg, v);
  audio.setEcho(state.echo);
  sayLine(voiceSample());
});
els.sfxSeg.addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.v;
  if (v === undefined) return;
  state.sfx = v === "1";
  savePref("sfx", state.sfx);
  setSeg(els.sfxSeg, v);
  if (state.sfx) sfx.summon();
});
els.hearingSeg.addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.v;
  if (!v) return;
  state.hearing = v;
  savePref("hearing", v);
  setSeg(els.hearingSeg, v);
});
els.previewVoice.addEventListener("click", () => sayLine(voiceSample(true)));

els.addressSel.value = state.address;
els.addressName.value = state.addressName;
els.addressName.hidden = state.address !== "name";
els.addressSel.addEventListener("change", () => {
  state.address = els.addressSel.value;
  savePref("address", state.address);
  els.addressName.hidden = state.address !== "name";
  if (state.address === "name") els.addressName.focus();
  clipCache.clear();
  warmLines();
  updateGreeting();
  if (state.address !== "name") sayLine(titled("Got it", "."));
});
els.addressName.addEventListener("change", () => {
  state.addressName = els.addressName.value.replace(/[^\p{L}\p{M} .'-]/gu, "").trim().slice(0, 30);
  els.addressName.value = state.addressName;
  savePref("addressName", state.addressName);
  clipCache.clear();
  warmLines();
  updateGreeting();
  sayLine(titled("Got it", "."));
});

/* ---------- Wiring ---------- */

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
  updateSendEnabled();
}

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy) return stopGeneration();
  const text = els.input.value;
  els.input.value = "";
  autosize();
  ask(text);
});
els.input.addEventListener("input", autosize);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});
document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => ask(chip.querySelector(".chip-prompt").textContent)));

els.messages.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-code");
  if (!btn) return;
  const code = btn.closest(".code").querySelector("code").textContent;
  navigator.clipboard?.writeText(code).then(() => toast("Code copied"));
});

els.mic.addEventListener("click", toggleMic);
els.liveBtn.addEventListener("click", () => startSession("live"));
els.liveEnd.addEventListener("click", endSession);
els.liveInterrupt.addEventListener("click", interruptSession);
els.orbSpot.addEventListener("click", interruptSession);
els.wakeBtn.addEventListener("click", () => { hideBanner(); setWake(!wake.enabled); });
els.banner.addEventListener("click", () => { hideBanner(); if (!wake.enabled) setWake(true); });

els.webBtn.setAttribute("aria-pressed", String(state.web));
els.webBtn.addEventListener("click", () => {
  state.web = !state.web;
  savePref("web", state.web);
  els.webBtn.setAttribute("aria-pressed", String(state.web));
  toast(state.web ? "Web search on" : "Web search off");
  refreshStatus();
});

els.speakToggle.setAttribute("aria-pressed", String(state.speakReplies));
els.speakToggle.addEventListener("click", () => {
  state.speakReplies = !state.speakReplies;
  savePref("speak", state.speakReplies);
  els.speakToggle.setAttribute("aria-pressed", String(state.speakReplies));
  if (!state.speakReplies) stopSpeaking();
});

els.model.addEventListener("change", () => {
  if (els.model.value.endsWith("-setup")) {
    const keyBox = { "claude-setup": els.claudeKey, "groq-setup": els.groqKey }[els.model.value] || els.geminiKey;
    els.model.value = lastModel; // not a real model: open that brain's setup instead
    openSettings(true, "brains");
    keyBox.focus();
    return;
  }
  lastModel = els.model.value;
  savePref("model", els.model.value);
  refreshStatus();
});

/* ---------- Gemini (optional online brain) ---------- */

function setBadge(badge, brain) {
  const ok = brain.configured && !brain.error;
  badge.textContent = !brain.configured ? "Not set up" : ok ? "Connected" : brain.error === "offline" ? "Offline" : "Check key";
  badge.className = "badge" + (ok ? " on" : brain.configured ? " warn" : "");
}

async function loadGemini() {
  try {
    state.gemini = await (await fetch("/api/gemini")).json();
  } catch {
    state.gemini = { configured: false, models: [] };
  }
  updateGeminiPanel();
}

function updateGeminiPanel(message) {
  const g = state.gemini;
  els.geminiState.textContent = message || (!g.configured
    ? "Not set up. Nexa uses Gemma on this PC."
    : g.error === "offline"
      ? `Key saved. You're offline, so Nexa uses Gemma until you reconnect.`
      : g.error
        ? `Key saved, but ${g.error}.`
        : `Connected. ${g.models.length} Gemini models available in the model menu.`);
  els.geminiRemove.hidden = !g.configured;
  setBadge($("geminiBadge"), g);
  els.geminiKey.placeholder = g.configured ? "Paste a new key to replace it" : "Paste your Gemini API key";
  updatePrefer();
}

els.geminiSave.addEventListener("click", async () => {
  const key = els.geminiKey.value.trim();
  if (!key) return els.geminiKey.focus();
  els.geminiSave.disabled = true;
  updateGeminiPanel("Checking the key with Google…");
  try {
    const r = await fetch("/api/gemini/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const res = await r.json();
    if (!r.ok) { updateGeminiPanel(res.error || "That key didn't work."); return; }
    els.geminiKey.value = "";
    state.gemini = { configured: true, models: res.models };
    modelKey = "";
    // Switch to Auto right away: Gemini while online, Gemma when offline or over the limit.
    els.model.value = "";
    savePref("model", "auto");
    await refreshStatus();
    updateGeminiPanel();
    toast(res.models.length ? `Nexa now uses ${res.models[0].label} when online, Gemma offline` : "Key saved");
  } catch {
    updateGeminiPanel("Couldn't reach Nexa's server.");
  } finally {
    els.geminiSave.disabled = false;
  }
});
els.geminiKey.addEventListener("keydown", (e) => { if (e.key === "Enter") els.geminiSave.click(); });

els.geminiRemove.addEventListener("click", async () => {
  await fetch("/api/gemini/key", { method: "DELETE" }).catch(() => {});
  state.gemini = { configured: false, models: [] };
  if (els.model.value.startsWith("gemini:")) savePref("model", "");
  modelKey = "";
  els.model.value = "";
  await refreshStatus();
  updateGeminiPanel();
  toast("Gemini key removed");
});

/* ---------- Claude (optional online brain, paid) ---------- */

async function loadClaude() {
  try {
    state.claude = await (await fetch("/api/claude")).json();
  } catch {
    state.claude = { configured: false, models: [] };
  }
  updateClaudePanel();
}

function updateClaudePanel(message) {
  const c = state.claude;
  els.claudeState.textContent = message || (!c.configured
    ? "Not set up."
    : c.error === "offline"
      ? "Key saved. You're offline, so Nexa uses Gemma until you reconnect."
      : c.error
        ? `Key saved, but ${c.error}.`
        : `Connected. ${c.models.length} Claude models available in the model menu.`);
  els.claudeRemove.hidden = !c.configured;
  setBadge($("claudeBadge"), c);
  els.claudeKey.placeholder = c.configured ? "Paste a new key to replace it" : "Paste your Claude API key";
  updatePrefer();
}

/** With two or more brains set up, choose which one Auto tries first. */
function updatePrefer() {
  const ready = BRAIN_ORDER.filter((p) => state[p].configured);
  els.preferField.hidden = ready.length < 2;
  els.preferSeg.querySelectorAll("button").forEach((b) => { b.hidden = !ready.includes(b.dataset.v); });
  setSeg(els.preferSeg, state.prefer);
}

els.claudeSave.addEventListener("click", async () => {
  const key = els.claudeKey.value.trim();
  if (!key) return els.claudeKey.focus();
  els.claudeSave.disabled = true;
  updateClaudePanel("Checking the key with Anthropic…");
  try {
    const r = await fetch("/api/claude/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const res = await r.json();
    if (!r.ok) { updateClaudePanel(res.error || "That key didn't work."); return; }
    els.claudeKey.value = "";
    state.claude = { configured: true, models: res.models };
    state.prefer = "claude";
    savePref("prefer", "claude");
    modelKey = "";
    els.model.value = "";
    savePref("model", "auto");
    await refreshStatus();
    updateClaudePanel();
    toast("Nexa now uses Claude when online, then Gemini, then Gemma offline");
  } catch {
    updateClaudePanel("Couldn't reach Nexa's server.");
  } finally {
    els.claudeSave.disabled = false;
  }
});
els.claudeKey.addEventListener("keydown", (e) => { if (e.key === "Enter") els.claudeSave.click(); });

els.claudeRemove.addEventListener("click", async () => {
  await fetch("/api/claude/key", { method: "DELETE" }).catch(() => {});
  state.claude = { configured: false, models: [] };
  if (els.model.value.startsWith("claude:")) savePref("model", "");
  modelKey = "";
  els.model.value = "";
  await refreshStatus();
  updateClaudePanel();
  toast("Claude key removed");
});

/* ---------- Groq (optional online brain, free and fast) ---------- */

async function loadGroq() {
  try {
    state.groq = await (await fetch("/api/groq")).json();
  } catch {
    state.groq = { configured: false, models: [] };
  }
  updateGroqPanel();
}

function updateGroqPanel(message) {
  const g = state.groq;
  els.groqState.textContent = message || (!g.configured
    ? "Not set up."
    : g.error === "offline"
      ? "Key saved. You're offline, so Nexa uses Gemma until you reconnect."
      : g.error
        ? `Key saved, but ${g.error}.`
        : `Connected. ${g.models.length} Groq models available in the model menu.`);
  els.groqRemove.hidden = !g.configured;
  setBadge($("groqBadge"), g);
  els.groqKey.placeholder = g.configured ? "Paste a new key to replace it" : "Paste your Groq API key";
  updatePrefer();
}

els.groqSave.addEventListener("click", async () => {
  const key = els.groqKey.value.trim();
  if (!key) return els.groqKey.focus();
  els.groqSave.disabled = true;
  updateGroqPanel("Checking the key with Groq…");
  try {
    const r = await fetch("/api/groq/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const res = await r.json();
    if (!r.ok) { updateGroqPanel(res.error || "That key didn't work."); return; }
    els.groqKey.value = "";
    state.groq = { configured: true, models: res.models };
    state.prefer = "groq";
    savePref("prefer", "groq");
    modelKey = "";
    els.model.value = "";
    savePref("model", "auto");
    await refreshStatus();
    updateGroqPanel();
    toast("Nexa now uses Groq when online, then your other brains, then Gemma offline");
  } catch {
    updateGroqPanel("Couldn't reach Nexa's server.");
  } finally {
    els.groqSave.disabled = false;
  }
});
els.groqKey.addEventListener("keydown", (e) => { if (e.key === "Enter") els.groqSave.click(); });

els.groqRemove.addEventListener("click", async () => {
  await fetch("/api/groq/key", { method: "DELETE" }).catch(() => {});
  state.groq = { configured: false, models: [] };
  if (els.model.value.startsWith("groq:")) savePref("model", "");
  modelKey = "";
  els.model.value = "";
  await refreshStatus();
  updateGroqPanel();
  toast("Groq key removed");
});

els.preferSeg.addEventListener("click", (e) => {
  const v = e.target.closest("button")?.dataset.v;
  if (!v) return;
  state.prefer = v;
  savePref("prefer", v);
  setSeg(els.preferSeg, v);
  refreshStatus();
});

els.newChat.addEventListener("click", startNewChat);

/* ---------- Saved chats (kept in this browser profile, on this PC) ---------- */

const chats = { list: loadPref("chats", []), current: null }; // [{id, title, updated, messages}]

function saveChats() {
  savePref("chats", chats.list.slice(0, 50));
}

/** Saves the open conversation (called after each reply). */
function persistChat() {
  if (!state.history.length) return;
  let chat = chats.list.find((c) => c.id === chats.current);
  if (!chat) {
    chat = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    chats.current = chat.id;
  }
  chat.messages = state.history.slice(-200);
  chat.title = chat.title || (state.history.find((m) => m.role === "user")?.content || "Chat").slice(0, 60);
  chat.updated = Date.now();
  chats.list = [chat, ...chats.list.filter((c) => c.id !== chat.id)];
  saveChats();
  renderChatList();
}

function renderChatList() {
  els.chatList.replaceChildren();
  if (!chats.list.length) {
    els.chatList.innerHTML = '<p class="chat-empty">No saved chats yet.</p>';
    return;
  }
  const day = 86400000, today = new Date().setHours(0, 0, 0, 0);
  const groupOf = (t) => (t >= today ? "Today" : t >= today - day ? "Yesterday" : t >= today - 7 * day ? "This week" : "Earlier");
  let group = "", index = 0;
  for (const chat of chats.list) {
    if (groupOf(chat.updated) !== group) {
      group = groupOf(chat.updated);
      els.chatList.insertAdjacentHTML("beforeend", `<div class="chat-group">${group}</div>`);
    }
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === chats.current ? " active" : "");
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.style.animationDelay = `${Math.min(index++, 12) * 30}ms`;
    item.innerHTML = '<span class="title"></span><button class="del" title="Delete chat" aria-label="Delete chat">'
      + '<svg class="i" viewBox="0 0 24 24"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7"/></svg></button>';
    item.querySelector(".title").textContent = chat.title;
    item.addEventListener("click", (e) => (e.target.closest(".del") ? deleteChat(chat.id) : openChat(chat.id)));
    item.addEventListener("keydown", (e) => { if (e.key === "Enter") openChat(chat.id); });
    els.chatList.append(item);
  }
}

function openChat(id) {
  const chat = chats.list.find((c) => c.id === id);
  if (!chat) return;
  stopGeneration();
  chats.current = id;
  state.history = chat.messages.map((m) => ({ ...m }));
  els.messages.replaceChildren();
  showWelcome(!state.history.length);
  for (const m of state.history) {
    if (m.role === "user") { addUserMessage(m.content); continue; }
    const row = addAssistantMessage();
    row.classList.remove("thinking");
    const body = row.querySelector(".body");
    body.innerHTML = renderMarkdown(m.content, m.sources || []);
    if (m.sources?.length) body.after(renderSources(m.sources));
    addMessageTools(row, m.content, m.brain || "");
  }
  scrollDown(true);
  renderChatList();
  toggleSidebar(false);
}

function deleteChat(id) {
  chats.list = chats.list.filter((c) => c.id !== id);
  saveChats();
  if (chats.current === id) startNewChat();
  else renderChatList();
}

function startNewChat() {
  stopGeneration();
  state.history = [];
  chats.current = null;
  els.messages.replaceChildren();
  showWelcome(true);
  renderChatList();
  toggleSidebar(false);
  els.input.focus();
}

function toggleSidebar(open = !els.sidebar.classList.contains("open")) {
  els.sidebar.classList.toggle("open", open);
  els.scrim.hidden = !open;
  els.menuBtn.setAttribute("aria-expanded", String(open));
}

els.menuBtn.addEventListener("click", () => toggleSidebar());
els.scrim.addEventListener("click", () => toggleSidebar(false));
els.sideNew.addEventListener("click", startNewChat);

// "Jump to newest" appears when you scroll up through a conversation.
els.chat.addEventListener("scroll", () => { els.toBottom.hidden = !els.welcome.hidden || nearBottom(); });
els.toBottom.addEventListener("click", () => els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: "smooth" }));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (session.on) endSession();
  else if (els.sidebar.classList.contains("open")) toggleSidebar(false);
  else if (!els.settings.hidden) openSettings(false);
  else stopSpeaking();
});

report("page-load", {
  wake: loadPref("wake", true),
  standalone: matchMedia("(display-mode: standalone)").matches,
  ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 90),
});
navigator.permissions?.query({ name: "microphone" }).then((p) => {
  report("mic-permission", { state: p.state });
  p.onchange = () => report("mic-permission", { state: p.state });
}).catch(() => {});

setSeg(els.styleSeg, state.style);
setSeg(els.echoSeg, state.echo);
setSeg(els.sfxSeg, state.sfx ? "1" : "0");
setSeg(els.hearingSeg, state.hearing);
autosize();
showWelcome(true);
Promise.all([loadVoices(), loadGemini(), loadClaude(), loadGroq()]).then(() => { updatePrefer(); refreshStatus(); });
renderChatList();
setWake(loadPref("wake", true)); // "Hey Nexa" listens from the start
els.input.focus();
