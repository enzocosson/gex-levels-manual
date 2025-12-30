// api/gexbot.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Extraire le path depuis l'URL
    // Ex: /api/gexbot/SPX/classic/zero?key=xxx
    const urlPath = req.url.replace("/api/gexbot/", "");

    // Séparer le path et la query string
    const [path, queryString] = urlPath.split("?");

    if (!path) {
      return res.status(400).json({ error: "Missing API path" });
    }

    // Construire l'URL complète vers l'API GexBot
    const apiUrl = `https://api.gexbot.com/${path}${
      queryString ? "?" + queryString : ""
    }`;

    console.log("🔄 Proxying:", apiUrl.replace(/key=[^&]+/, "key=***"));

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GEX-Levels-App/1.0",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error ${response.status}:`, errorText);
      return res.status(response.status).json({
        error: `API returned ${response.status}`,
        details: errorText,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Proxy error:", error);
    return res.status(500).json({
      error: "Internal proxy error",
      message: error.message,
    });
  }
}
