# ISM6427 Music Generator

A small web app that lets users generate songs with [SunoAPI](https://docs.sunoapi.org/).
Static HTML/CSS/JS front end + Netlify Functions that hold the API key server-side.

## How it works

```
Browser (public/)  ──POST──▶  /.netlify/functions/generate  ──▶  SunoAPI /api/v1/generate        → taskId
Browser  ──GET every 5s──▶    /.netlify/functions/status    ──▶  SunoAPI /api/v1/generate/record-info
```

- The API key is **never** sent to the browser or stored in this repo.
- SunoAPI requires a `callBackUrl`; it points at `/.netlify/functions/callback`, which just replies "ok". The app polls for status instead.
- Generated files are kept by SunoAPI for 14 days.

## Deploy on Netlify

1. Netlify → **Add new site → Import an existing project** → pick this repo.
2. Build settings are read from `netlify.toml` (no build command; publish dir `public`).
3. **Site configuration → Environment variables**, add:
   - `SUNO_API_KEY` = your SunoAPI key (required)
   - `SUNO_API_BASE` = optional; defaults to `https://apibox.erweima.ai` (the host used in the SunoAPI docs examples). Set to `https://api.sunoapi.org` if your account uses that host.
4. Deploy (or **Trigger deploy** after adding the variables).

## Local development (optional)

```bash
npm install -g netlify-cli
SUNO_API_KEY=your_key netlify dev
```

## Files

| Path | Purpose |
|---|---|
| `public/index.html`, `style.css`, `app.js` | UI ("Ember" design): Create → Your songs → Now playing; colors follow the album cover (aqua before any song) |
| `netlify/functions/generate.mjs` | Validates input per SunoAPI rules, starts a task |
| `netlify/functions/status.mjs` | Polls task status, returns simplified track list |
| `netlify/functions/cover.mjs` | Re-serves a cover image from our domain so the browser can read its colors |
| `netlify/functions/callback.mjs` | No-op endpoint for SunoAPI's required callback |
| `netlify/lib/suno.mjs` | Shared fetch helper (auth header, error handling) |
