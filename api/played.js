import { kv } from "@vercel/kv";

const OFFSET = 78;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "POST") {
      const { uuid } = req.body;
      if (uuid) await kv.sadd("players", uuid);
    }

    const count = (await kv.scard("players")) || 0;
    return res.status(200).json({ count: count + OFFSET });
  } catch {
    return res.status(200).json({ count: OFFSET });
  }
}
