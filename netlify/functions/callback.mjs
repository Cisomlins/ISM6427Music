// POST /.netlify/functions/callback
// SunoAPI requires a callBackUrl. The app polls /status instead, so this just acknowledges.
export default async () => new Response("ok", { status: 200 });
