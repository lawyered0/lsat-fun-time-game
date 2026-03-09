import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ─── GET: return top 50 scores ───
    if (req.method === "GET") {
      const entries = await getLeaderboard();
      return res.status(200).json({ entries });
    }

    // ─── POST: submit / update a score ───
    if (req.method === "POST") {
      const { uuid, name, correct, total } = req.body;

      if (!uuid || !name || correct === undefined || !total) {
        return res.status(400).json({ error: "Missing fields" });
      }

      const pct = Math.round((correct / total) * 100);
      const trimmedName = String(name).trim().substring(0, 20);

      // Only update if new score is higher
      const existing = await kv.zscore("leaderboard", uuid);
      if (existing === null || pct > existing) {
        await kv.zadd("leaderboard", { score: pct, member: uuid });
        await kv.hset(`lb:${uuid}`, {
          name: trimmedName,
          correct,
          total,
          pct,
          date: new Date().toISOString().split("T")[0],
        });
      }

      const entries = await getLeaderboard(uuid);
      return res.status(200).json({ entries });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Leaderboard unavailable" });
  }
}

async function getLeaderboard(currentUuid) {
  // Top 50 UUIDs by score descending
  const uuids = await kv.zrange("leaderboard", 0, 49, { rev: true });
  if (!uuids || uuids.length === 0) return [];

  const entries = [];
  for (const uid of uuids) {
    const data = await kv.hgetall(`lb:${uid}`);
    if (data) {
      entries.push({
        rank: entries.length + 1,
        name: data.name,
        pct: Number(data.pct),
        correct: Number(data.correct),
        total: Number(data.total),
        date: data.date,
        isYou: uid === currentUuid,
      });
    }
  }
  return entries;
}
