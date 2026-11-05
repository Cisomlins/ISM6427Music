// Front end: collects the form, calls our Netlify functions, polls until songs are ready.
const $ = (id) => document.getElementById(id);
const form = $("form");
const msg = $("message");
const results = $("results");
const submitBtn = $("submit");

let mode = "simple";
const POLL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;

const STATUS_TEXT = {
  PENDING: "Queued — waiting to start…",
  TEXT_SUCCESS: "Lyrics written — composing music…",
  FIRST_SUCCESS: "First version ready — finishing the second…",
  SUCCESS: "Done!",
};

// Mode tabs
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    document.querySelectorAll(".simple-only").forEach((el) => (el.hidden = mode !== "simple"));
    document.querySelectorAll(".custom-only").forEach((el) => (el.hidden = mode !== "custom"));
  });
});

// Hide lyrics when instrumental
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

function setMessage(text, isError = false) {
  msg.textContent = text;
  msg.classList.toggle("error", isError);
}

function payload() {
  const base = {
    customMode: mode === "custom",
    instrumental: $("instrumental").checked,
    model: $("model").value,
    style: $("style").value,
    lyrics: $("lyrics").value,
  };
  if (mode === "simple") return { ...base, prompt: $("prompt").value };
  return {
    ...base,
    title: $("title").value,
    negativeTags: $("negativeTags").value,
    vocalGender: $("vocalGender").value,
    duration: $("duration").value,
  };
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status}).` }));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(sec) {
  if (!sec) return "";
  const s = Math.round(sec);
  return ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render(tracks) {
  results.innerHTML = tracks
    .map((t) => {
      const src = t.audioUrl || t.streamAudioUrl;
      if (!src) return "";
      return `<article class="track">
        ${t.imageUrl ? `<img src="${esc(t.imageUrl)}" alt="Cover art for ${esc(t.title)}">` : `<img alt="">`}
        <div>
          <h2>${esc(t.title || "Untitled")}</h2>
          <p class="tags">${esc(t.tags)}${fmt(t.duration)}</p>
          <audio controls preload="none" src="${esc(src)}"></audio>
          ${t.audioUrl ? `<p><a href="${esc(t.audioUrl)}" target="_blank" rel="noopener" download>Download MP3</a></p>` : `<p class="tags">Streaming preview — download available when finished.</p>`}
        </div>
      </article>`;
    })
    .join("");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(taskId) {
  const start = Date.now();
  let lastRendered = "";
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    let data;
    try {
      data = await api(`/.netlify/functions/status?taskId=${encodeURIComponent(taskId)}`);
    } catch (err) {
      setMessage(`Checking status… (${err.message}) retrying`);
      continue;
    }
    if (data.failed) throw new Error(data.error || `Generation failed (${data.status}).`);

    // Only re-render when something changed, so the audio players don't reset mid-play.
    const key = JSON.stringify(data.tracks.map((t) => [t.id, t.audioUrl, t.streamAudioUrl]));
    if (key !== lastRendered) {
      render(data.tracks);
      lastRendered = key;
    }
    const secs = Math.round((Date.now() - start) / 1000);
    setMessage(`${STATUS_TEXT[data.status] || data.status} (${secs}s)`);
    if (data.status === "SUCCESS") return;
  }
  throw new Error("This is taking longer than expected. Please try again later.");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  results.innerHTML = "";
  setMessage("Sending your request…");
  try {
    const { taskId } = await api("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    setMessage(STATUS_TEXT.PENDING);
    await poll(taskId);
  } catch (err) {
    setMessage(err.message, true);
  } finally {
    submitBtn.disabled = false;
  }
});
