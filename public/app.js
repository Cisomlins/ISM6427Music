// Front end: three views (Create → Your songs → Now playing).
// Talks only to our Netlify functions; the API key never reaches the browser.
const $ = (id) => document.getElementById(id);

const POLL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_PALETTE = { h: 185, s: 80 }; // aqua, before any cover exists

const VIBES = ["Pop", "Forró", "Hip-hop", "Lo-fi", "Country", "Rock", "Samba", "Jazz", "EDM"];
const CHIPS = ["Upbeat", "Chill", "Acoustic", "Romantic", "Funny"];

const STATUS_TEXT = {
  PENDING: ["Queued", "Waiting to start…", 0],
  TEXT_SUCCESS: ["Lyrics written", "Composing the music…", 1],
  FIRST_SUCCESS: ["First version ready", "Finishing the second one…", 2],
  SUCCESS: ["2 versions ready", "", 3],
};

let mode = "simple";
let tracks = [];
let current = -1; // index of the track open in the player
let running = false;

/* ---------------- Views ---------------- */
function show(view) {
  for (const v of ["Create", "Songs", "Player"]) $("view" + v).hidden = v.toLowerCase() !== view;
  if (view !== "player") $("audio").pause();
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});
$("toSongs").addEventListener("click", () => show("songs"));

/* ---------------- Palette from album cover ---------------- */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Picks the most prominent colourful hue: 12 hue buckets, weighted by saturation.
function extractPalette(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 48);
  const data = ctx.getImageData(0, 0, 48, 48).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, x: 0, y: 0, s: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.1 || l > 0.92 || s < 0.15) continue;
    const w = s * (1 - Math.abs(l - 0.5));
    const b = bins[Math.floor(h / 30) % 12];
    const rad = (h * Math.PI) / 180;
    b.w += w; b.x += Math.cos(rad) * w; b.y += Math.sin(rad) * w; b.s += s * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < 1) return { h: DEFAULT_PALETTE.h, s: 12 }; // greyscale cover → muted
  const h = ((Math.atan2(best.y, best.x) * 180) / Math.PI + 360) % 360;
  const s = Math.min(85, Math.max(35, (best.s / best.w) * 100));
  return { h: Math.round(h), s: Math.round(s) };
}

function hslLuminance(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

function applyPalette({ h, s }) {
  const root = document.documentElement.style;
  root.setProperty("--h", h);
  root.setProperty("--s", s);
  // White text on the accent only if it stays readable; otherwise dark text.
  root.setProperty("--on-accent", hslLuminance(h, s, 52) > 0.3 ? "#0b1214" : "#ffffff");
  document.querySelector('meta[name="theme-color"]').content = `hsl(${h} 55% 5%)`;
}

const paletteCache = new Map();
async function useCover(url) {
  const bg = $("backdropImg");
  if (!url) {
    bg.classList.remove("on");
    applyPalette(DEFAULT_PALETTE);
    return;
  }
  bg.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
  bg.classList.add("on");
  if (paletteCache.has(url)) return applyPalette(paletteCache.get(url));
  try {
    const img = new Image();
    img.src = `/.netlify/functions/cover?url=${encodeURIComponent(url)}`;
    await img.decode();
    const p = extractPalette(img);
    paletteCache.set(url, p);
    applyPalette(p);
  } catch {
    // Keep the current colours if the cover can't be read; the blurred image still shows.
  }
}

/* ---------------- Create view ---------------- */
document.querySelectorAll(".seg").forEach((tab) => {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode;
    document.querySelectorAll(".seg").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    document.querySelectorAll(".simple-only").forEach((el) => (el.hidden = mode !== "simple"));
    document.querySelectorAll(".custom-only").forEach((el) => (el.hidden = mode !== "custom"));
  });
});

// Style field helpers: vibes and chips add/remove a term.
const styleTerms = () => $("style").value.split(",").map((t) => t.trim()).filter(Boolean);
function hasTerm(term) {
  return styleTerms().some((t) => t.toLowerCase() === term.toLowerCase());
}
function toggleTerm(term) {
  const terms = styleTerms();
  const i = terms.findIndex((t) => t.toLowerCase() === term.toLowerCase());
  if (i >= 0) terms.splice(i, 1); else terms.push(term.toLowerCase());
  $("style").value = terms.join(", ");
  $("style").dispatchEvent(new Event("input"));
}
function syncOrbs() {
  document.querySelectorAll(".orb").forEach((o) => o.setAttribute("aria-pressed", hasTerm(o.dataset.term)));
}
VIBES.forEach((v, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "orb";
  b.textContent = v;
  b.dataset.term = v;
  b.style.setProperty("--o", (i * 40) % 360 - 60);
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => toggleTerm(v));
  $("orbs").appendChild(b);
});
CHIPS.forEach((c) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = "+ " + c;
  b.addEventListener("click", () => toggleTerm(c));
  $("chips").appendChild(b);
});
$("style").addEventListener("input", syncOrbs);

$("instrumental").addEventListener("change", (e) => {
  document.querySelector(".lyrics-wrap").hidden = e.target.checked;
});

// Character counters
document.querySelectorAll(".count").forEach((c) => {
  const field = $(c.dataset.for);
  const update = () => (c.textContent = `${field.value.length}/${c.dataset.max}`);
  field.addEventListener("input", update);
  update();
});

// Length slider with glowing ticks
const TICKS = 11;
for (let i = 0; i < TICKS; i++) $("ticks").appendChild(document.createElement("span"));
const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function syncLength() {
  const on = $("setLength").checked;
  const r = $("duration");
  r.disabled = !on;
  $("lengthBox").setAttribute("aria-disabled", String(!on));
  $("durationOut").textContent = on ? fmt(r.value) : "Auto";
  const pos = Math.round(((r.value - r.min) / (r.max - r.min)) * (TICKS - 1));
  [...$("ticks").children].forEach((t, i) => {
    t.classList.toggle("on", on && i === pos);
    t.style.setProperty("--a", (0.85 - Math.abs(i - pos) * 0.12).toFixed(2));
  });
}
$("setLength").addEventListener("change", syncLength);
$("duration").addEventListener("input", syncLength);
syncLength();

function payload() {
  const base = {
    customMode: mode === "custom",
    instrumental: $("instrumental").checked,
    model: mode === "custom" ? $("model").value : "V6",
    style: $("style").value,
    lyrics: $("lyrics").value,
  };
  if (mode === "simple") return { ...base, prompt: $("prompt").value };
  return {
    ...base,
    title: $("title").value,
    negativeTags: $("negativeTags").value,
    vocalGender: $("vocalGender").value,
    duration: $("setLength").checked ? $("duration").value : "",
  };
}

/* ---------------- API ---------------- */
async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status}).` }));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Songs view ---------------- */
function setStatus(state, title, sub, step) {
  const card = document.querySelector(".status-card");
  card.dataset.state = state;
  $("statusTitle").textContent = title;
  $("statusSub").textContent = sub;
  document.querySelector(".steps").dataset.step = step;
}

function waveFor(id) {
  // Decorative bars, stable per track.
  let seed = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 7);
  const bars = [];
  for (let i = 0; i < 26; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    bars.push(`<i style="height:${5 + Math.round((seed / 233280) * 13)}px"></i>`);
  }
  return bars.join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTracks() {
  $("trackList").innerHTML = tracks
    .map((t, i) => {
      const ready = Boolean(t.audioUrl || t.streamAudioUrl);
      return `<article class="track">
        ${t.imageUrl ? `<img src="${esc(t.imageUrl)}" alt="">` : `<div class="cover-ph"></div>`}
        <div class="track-info">
          <h2>${esc(t.title || "Untitled")}</h2>
          <span>${t.duration ? fmt(t.duration) : ready ? "Preview ready" : "In progress…"}</span>
          <div class="wave" aria-hidden="true">${waveFor(t.id)}</div>
        </div>
        <button type="button" class="play-pill" data-play="${i}" ${ready ? "" : "disabled"} aria-label="Play ${esc(t.title || "version " + (i + 1))}">
          <svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>Play
        </button>
      </article>`;
    })
    .join("");
}
$("trackList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-play]");
  if (b) openPlayer(Number(b.dataset.play), true);
});

/* ---------------- Player view ---------------- */
const audio = $("audio");
function openPlayer(i, autoplay) {
  const t = tracks[i];
  if (!t) return;
  const src = t.audioUrl || t.streamAudioUrl;
  if (current !== i || audio.getAttribute("src") !== src) {
    current = i;
    audio.src = src;
  }
  $("pCover").src = t.imageUrl || "";
  $("pCover").alt = t.imageUrl ? `Cover art for ${t.title || "this song"}` : "";
  $("pTitle").textContent = t.title || "Untitled";
  $("pTags").textContent = t.tags || "";
  $("pLyrics").textContent = t.lyrics || "";
  $("pLyricsBox").hidden = !t.lyrics;
  const dl = $("pDownload");
  dl.hidden = !t.audioUrl;
  dl.href = t.audioUrl || "#";
  useCover(t.imageUrl);
  show("player");
  if (autoplay) audio.play().catch(() => {});
}

$("playPause").addEventListener("click", () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
$("back10").addEventListener("click", () => (audio.currentTime = Math.max(0, audio.currentTime - 10)));
$("fwd10").addEventListener("click", () => (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10)));
const seek = $("seek");
seek.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
});
function syncTime() {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seek.value = pct;
  seek.style.setProperty("--pct", pct + "%");
  $("tCur").textContent = fmt(audio.currentTime);
  $("tDur").textContent = fmt(audio.duration || tracks[current]?.duration);
}
audio.addEventListener("timeupdate", syncTime);
audio.addEventListener("loadedmetadata", syncTime);
audio.addEventListener("play", () => { $("playPause").classList.add("playing"); $("playPause").setAttribute("aria-label", "Pause"); });
audio.addEventListener("pause", () => { $("playPause").classList.remove("playing"); $("playPause").setAttribute("aria-label", "Play"); });

/* ---------------- Generate + poll ---------------- */
async function poll(taskId) {
  const start = Date.now();
  let lastKey = "";
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    let data;
    try {
      data = await api(`/.netlify/functions/status?taskId=${encodeURIComponent(taskId)}`);
    } catch {
      continue; // transient error: keep trying
    }
    if (data.failed) throw new Error(data.error || `Generation failed (${data.status}).`);

    const key = JSON.stringify(data.tracks.map((t) => [t.id, t.title, t.audioUrl, t.streamAudioUrl, t.imageUrl, t.lyrics]));
    if (key !== lastKey) {
      lastKey = key;
      tracks = data.tracks;
      renderTracks();
      if (tracks[0]?.imageUrl && current < 0) useCover(tracks[0].imageUrl);
    }
    const secs = Math.round((Date.now() - start) / 1000);
    const [title, sub, step] = STATUS_TEXT[data.status] || [data.status, "", 0];
    if (data.status === "SUCCESS") {
      setStatus("done", title, `Made in ${secs} seconds · kept for 14 days`, 3);
      return;
    }
    setStatus("working", title, `${sub} (${secs}s)`, step);
  }
  throw new Error("This is taking longer than expected. Please try again later.");
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (running) return;
  running = true;
  $("submit").disabled = true;
  $("formError").textContent = "";
  try {
    const { taskId } = await api("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    tracks = [];
    current = -1;
    audio.removeAttribute("src");
    renderTracks();
    useCover(null);
    $("toSongs").hidden = false;
    setStatus("working", "Queued", "Waiting to start…", 0);
    show("songs");
    await poll(taskId);
  } catch (err) {
    if (!$("viewCreate").hidden) $("formError").textContent = err.message;
    else setStatus("error", "Something went wrong", err.message, 0);
  } finally {
    running = false;
    $("submit").disabled = false;
  }
});

applyPalette(DEFAULT_PALETTE);
