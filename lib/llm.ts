import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  timeout: 60_000, // 60s，对齐 spec 7.3
});

export async function callLLM(
  prompt: string,
  system?: string,
  maxTokens = 16000
): Promise<string> {
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const resp = await client.chat.completions.create({
    model: process.env.LLM_MODEL!,
    messages,
    max_tokens: maxTokens,
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return content;
}
