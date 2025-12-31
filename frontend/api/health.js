/* global process */

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const env = (typeof process !== 'undefined' && process && process.env && process.env.NODE_ENV)
    ? process.env.NODE_ENV
    : 'unknown';
  return res.status(200).json({ status: 'ok', env });
}
