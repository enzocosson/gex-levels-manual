// api/gexbot.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  return res.status(410).json({
    error: "NOT_AVAILABLE_HERE",
    message:
      "This API file exists at repository root but the Vercel project is probably configured to use the 'frontend' folder as root.\nIf you want API functions here, change the Project Root in Vercel to '/'. Otherwise, use the functions in '/frontend/api/'.",
  });
}
