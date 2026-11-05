// GET /.netlify/functions/status?taskId=...
// Polls SunoAPI for a task and returns a simplified result for the browser.
import { json, suno } from "../lib/suno.mjs";

const FAILED = ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"];

export default async (req) => {
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return json(400, { error: "Missing or invalid taskId." });

  try {
    const data = await suno(`/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    const tracks = (data?.response?.sunoData || []).map((t) => ({
      id: t.id,
      title: t.title,
      tags: t.tags,
      duration: t.duration,
      audioUrl: t.audio_url || t.audioUrl || "",
      streamAudioUrl: t.stream_audio_url || t.streamAudioUrl || "",
      imageUrl: t.image_url || t.imageUrl || "",
    }));
    return json(200, {
      status: data?.status || "PENDING",
      failed: FAILED.includes(data?.status),
      error: data?.errorMessage || null,
      tracks,
    });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
