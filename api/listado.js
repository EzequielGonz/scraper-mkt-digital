const { kv } = require("@vercel/kv");

const KV_HASH = "negocios";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método no permitido, usá GET." });
    return;
  }

  try {
    const todos = await kv.hgetall(KV_HASH);
    const lista = Object.values(todos || {}).map((v) =>
      typeof v === "string" ? JSON.parse(v) : v
    );
    res.status(200).json({ ok: true, total: lista.length, negocios: lista });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo leer la base." });
  }
};
