// POST /.netlify/functions/generate
// Validates the form input against the SunoAPI rules and starts a generation task.
import { json, suno } from "../lib/suno.mjs";

const MODELS = ["V6", "V6_WILD", "V6_MINI"];

const str = (v) => (typeof v === "string" ? v.trim() : "");

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  let input;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const customMode = input.customMode === true;
  const instrumental = input.instrumental === true;
  const model = MODELS.includes(input.model) ? input.model : "V6";
  const prompt = str(input.prompt);
  const style = str(input.style);
  const lyrics = instrumental ? "" : str(input.lyrics);

  // SunoAPI requires a callback URL; we point it at our own no-op endpoint
  // and poll for status instead.
  const callBackUrl = `${new URL(req.url).origin}/.netlify/functions/callback`;

  const body = { customMode, instrumental, model, callBackUrl };
  const errors = [];

  if (style.length > 1000) errors.push("Style must be 1000 characters or fewer.");
  if (lyrics.length > 5000) errors.push("Lyrics must be 5000 characters or fewer.");
  if (style) body.style = style;
  if (lyrics) body.lyrics = lyrics;

  if (customMode) {
    const title = str(input.title);
    const negativeTags = str(input.negativeTags);
    if (title.length > 80) errors.push("Title must be 80 characters or fewer.");
    if (negativeTags.length > 1000) errors.push("Styles to avoid must be 1000 characters or fewer.");
    if (!style && !lyrics && !negativeTags) errors.push("Custom mode needs at least a style, lyrics, or styles to avoid.");
    if (title) body.title = title;
    if (negativeTags) body.negativeTags = negativeTags;
    if (input.vocalGender === "m" || input.vocalGender === "f") body.vocalGender = input.vocalGender;
    if (input.duration !== undefined && input.duration !== "" && input.duration !== null) {
      const d = Number(input.duration);
      if (!Number.isInteger(d) || d < 10 || d > 360) errors.push("Length must be a whole number of seconds between 10 and 360.");
      else body.duration = d;
    }
  } else {
    if (prompt.length > 3000) errors.push("Description must be 3000 characters or fewer.");
    if (prompt) body.prompt = prompt;
    // Per the docs, non-custom mode needs at least a style or lyrics.
    if (!style && !lyrics) errors.push("Add a style (e.g. \"lo-fi, chill\") or lyrics.");
  }

  if (errors.length) return json(400, { error: errors.join(" ") });

  try {
    const data = await suno("/api/v1/generate", { method: "POST", body: JSON.stringify(body) });
    return json(200, { taskId: data.taskId });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
