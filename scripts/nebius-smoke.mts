// Live check against Nebius Token Factory. Usage:
//   npm run nebius:models   (list NVIDIA/Nemotron model IDs available to your key)
//   npm run nebius:ping     (one structured-output call to NEBIUS_MODEL)
// Calls the paid API; not part of CI.
import OpenAI from "openai";

const key = process.env.NEBIUS_API_KEY;
if (!key) throw new Error("NEBIUS_API_KEY is not set (use .env.local, never commit it)");
const client = new OpenAI({ apiKey: key, baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/" });

const mode = process.argv[2] ?? "models";
if (mode === "models") {
  const list = await client.models.list();
  for (const m of list.data) if (/nemotron|nvidia/i.test(m.id)) console.log(m.id);
} else {
  const model = process.env.NEBIUS_MODEL;
  if (!model) throw new Error("NEBIUS_MODEL is not set");
  const t = Date.now();
  const res = await client.chat.completions.create({
    model,
    max_tokens: 200,
    messages: [{ role: "user", content: 'Reply with JSON {"ok": true, "model": "<your name>"}' }],
    response_format: { type: "json_schema", json_schema: { name: "ping", schema: { type: "object", properties: { ok: { type: "boolean" }, model: { type: "string" } }, required: ["ok"] } } },
  });
  console.log(res.choices[0]?.message?.content, res.usage, `${Date.now() - t}ms`);
}
