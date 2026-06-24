/**
 * Gemini 2.0 Flash caller — inline PDF + JSON schema structured output.
 * Uses GEMINI_API_KEY secret. No OCR pre-step needed; Gemini reads PDFs natively.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function getKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY secret not set in Supabase");
  return key;
}

export interface CallGeminiOptions {
  base64Pdf:         string;
  systemInstruction: string;
  userText:          string;
  responseSchema:    Record<string, unknown>;
  timeoutMs?:        number;
}

export async function callGemini(opts: CallGeminiOptions): Promise<Record<string, unknown>> {
  const { base64Pdf, systemInstruction, userText, responseSchema, timeoutMs = 120_000 } = opts;

  const key = getKey();
  const url = `${GEMINI_API}?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        role: "user",
        parts: [
          { text: userText },
          { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini returned no content. Raw: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}
