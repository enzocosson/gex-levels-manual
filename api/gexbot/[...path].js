// placeholder to avoid duplicate serverless exports; real handler is in ../gexbot.js
// api/gexbot/[...path].js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Récupérer le path depuis les query params (Vercel fournit `path` pour [...path])
    const { path } = req.query;

    if (!path || (Array.isArray(path) && path.length === 0)) {
      return res.status(400).json({ error: "Missing path" });
    }

    // Joindre le path
    const apiPath = Array.isArray(path) ? path.join("/") : path;

    // Récupérer la query string (tous les autres params)
    const queryParams = new URLSearchParams();
    Object.keys(req.query).forEach((key) => {
      if (key !== "path") {
        const v = req.query[key];
        if (Array.isArray(v)) {
          v.forEach((x) => queryParams.append(key, x));
        } else {
          queryParams.append(key, v);
        }
      }
    });

    const apiUrl = `https://api.gexbot.com/${apiPath}${
      queryParams.toString() ? `?${queryParams.toString()}` : ""
    }`;

    console.log("🔄 Proxying to:", apiUrl.replace(/key=[^&]+/, "key=***"));

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GEX-Levels/1.0",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API Error ${response.status}:`, text);
      return res.status(response.status).json({
        error: `API returned ${response.status}`,
        details: text,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Proxy error:", error);
    return res.status(500).json({
      error: "Proxy failed",
      message: error.message,
      stack: error.stack,
    });
  }
}
