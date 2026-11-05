// Shared helpers for talking to SunoAPI. Runs on Netlify's servers only,
// so the API key never reaches the browser.

// Base URL from the SunoAPI docs examples; override with SUNO_API_BASE if needed.
export const API_BASE = (process.env.SUNO_API_BASE || "https://apibox.erweima.ai").replace(/\/$/, "");

export function apiKey() {
  const key = process.env.SUNO_API_KEY;
  if (!key) throw new Error("Server is missing SUNO_API_KEY. Set it in Netlify > Site configuration > Environment variables.");
  return key;
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function suno(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`SunoAPI returned a non-JSON response (HTTP ${res.status}).`);
  }
  // SunoAPI wraps everything as { code, msg, data }; code 200 means success.
  if (!res.ok || data.code !== 200) {
    throw new Error(data.msg || `SunoAPI error (HTTP ${res.status}, code ${data.code}).`);
  }
  return data.data;
}
