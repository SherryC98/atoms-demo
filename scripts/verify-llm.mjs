import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  timeout: 60_000,
});

const r = await client.chat.completions.create({
  model: process.env.LLM_MODEL,
  max_tokens: 16,
  messages: [{ role: "user", content: "reply with the single word: ok" }],
});

console.log("LLM OK:", r.choices[0]?.message?.content);
