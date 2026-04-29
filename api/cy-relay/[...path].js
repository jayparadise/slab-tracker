// Vercel serverless function — passthrough proxy for api.courtyard.io.
// Tests whether Vercel's egress IP gets through Courtyard's WAF.

const RELAY_SECRET = "1b2a6feda2b3e457aa1957af54c508adf8776eeb2ba55b0c7774c23fed5c16ed";
const TARGET_BASE = "https://api.courtyard.io";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${RELAY_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  const segments = req.query.path || [];
  const path = "/" + (Array.isArray(segments) ? segments.join("/") : segments);

  // Forward query string except `path` (used by the catch-all)
  const qs = Object.entries(req.query)
    .filter(([k]) => k !== "path")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const target = TARGET_BASE + path + (qs ? `?${qs}` : "");

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://courtyard.io/",
        "Origin": "https://courtyard.io",
      },
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
