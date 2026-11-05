// GET /.netlify/functions/cover?url=<https image url>
// Re-serves a song's cover image from our own domain so the browser is allowed
// to read its pixels and match the app's colors to it. Images only, 5 MB max.
const MAX_BYTES = 5 * 1024 * 1024;

function blockedHost(host) {
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) || // IPv4 literal
    host.includes(":") // IPv6 literal
  );
}

const bad = (status, msg) => new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

export default async (req) => {
  let target;
  try {
    target = new URL(new URL(req.url).searchParams.get("url") || "");
  } catch {
    return bad(400, "Invalid url.");
  }
  if (target.protocol !== "https:" || blockedHost(target.hostname)) return bad(400, "URL not allowed.");

  let res;
  try {
    res = await fetch(target, { redirect: "follow" });
  } catch {
    return bad(502, "Could not fetch image.");
  }
  if (blockedHost(new URL(res.url || target.href).hostname)) return bad(400, "URL not allowed.");
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) return bad(502, "Not an image.");
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return bad(413, "Image too large.");

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return bad(413, "Image too large.");
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
  });
};
