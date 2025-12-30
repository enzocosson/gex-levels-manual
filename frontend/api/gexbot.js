// api/gexbot.js
export default async function handler(req, res) {
  // Permettre CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Gérer les preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Extraire le path après /api/gexbot
  const { path } = req.query;

  if (!path || path.length === 0) {
    return res.status(400).json({ error: "Missing path parameter" });
  }

  // Reconstruire l'URL complète
  const apiPath = Array.isArray(path) ? path.join("/") : path;
  const queryString = new URLSearchParams(req.query).toString();
  const apiUrl = `https://api.gexbot.com/${apiPath}${
    queryString ? "?" + queryString : ""
  }`;

  console.log("🔄 Proxying to:", apiUrl.replace(/key=[^&]+/, "key=***"));

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(`❌ API Error: ${response.status}`);
      return res.status(response.status).json({
        error: `API returned ${response.status}`,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Proxy error:", error);
    return res.status(500).json({
      error: "Proxy request failed",
      message: error.message,
    });
  }
}
