/**
 * Rehbar AI client — Mistral AI.
 * - PDFs: mistral-ocr-latest extracts text first, then mistral-large-latest for structured output
 * - Images: pixtral-large-latest (vision)
 * - Text/Excel: mistral-large-latest
 * All extraction and generation in this codebase runs through this module.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

const MISTRAL_API   = "https://api.mistral.ai/v1";
const MODEL_VISION  = "pixtral-large-latest";
const MODEL_TEXT    = "mistral-large-latest";
const MODEL_OCR     = "mistral-ocr-latest";

// ── File content types ────────────────────────────────────────────────────────

export type FileContent =
  | { type: "pdf";   base64: string }
  | { type: "image"; base64: string; mime: string }
  | { type: "text";  text: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

function getKey(): string {
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("MISTRAL_API_KEY secret not set in Supabase");
  return key;
}

/** Extract text from a PDF via Mistral OCR API. Returns markdown string. */
async function ocrPdf(base64: string, key: string): Promise<string> {
  const res = await fetch(`${MISTRAL_API}/ocr`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:    MODEL_OCR,
      document: { type: "document_url", document_url: `data:application/pdf;base64,${base64}` },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mistral OCR ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  // pages is an array; join all page markdown
  const pages: { markdown?: string }[] = json.pages ?? [];
  return pages.map(p => p.markdown ?? "").join("\n\n");
}

/** Build Mistral messages array from FileContent list + user text. */
function buildMessages(
  userText: string,
  files: FileContent[],
  ocrTexts: Map<number, string>,
): { role: string; content: unknown }[] {
  const content: unknown[] = [{ type: "text", text: userText }];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.type === "text") {
      content.push({ type: "text", text: f.text });
    } else if (f.type === "pdf") {
      // PDF was pre-processed by OCR; inject as text
      const ocrText = ocrTexts.get(i) ?? "";
      if (ocrText) content.push({ type: "text", text: `[Extracted document text]\n${ocrText}` });
    } else if (f.type === "image") {
      content.push({
        type:      "image_url",
        image_url: { url: `data:${f.mime};base64,${f.base64}` },
      });
    }
  }

  return [{ role: "user", content }];
}

/** True if any file is an image (needs vision model). */
function needsVision(files: FileContent[]): boolean {
  return files.some(f => f.type === "image");
}

// ── Structured output via tool use ────────────────────────────────────────────

export interface CallAIOptions {
  systemPrompt:    string;
  userText:        string;
  files?:          FileContent[];
  toolName:        string;
  toolDescription: string;
  toolSchema:      Record<string, unknown>;
  toolRequired?:   string[];
  maxTokens?:      number;
  retries?:        number;
  timeoutMs?:      number;
}

export async function callAI(opts: CallAIOptions): Promise<Record<string, unknown>> {
  const {
    systemPrompt, userText, files = [],
    toolName, toolDescription, toolSchema, toolRequired = [],
    maxTokens = 8192, retries = 2, timeoutMs = 110_000,
  } = opts;

  const key = getKey();

  // Pre-process PDFs via OCR (outside retry loop — expensive, do once)
  const ocrTexts = new Map<number, string>();
  for (let i = 0; i < files.length; i++) {
    if (files[i].type === "pdf") {
      ocrTexts.set(i, await ocrPdf((files[i] as { type: "pdf"; base64: string }).base64, key));
    }
  }

  const model    = needsVision(files) ? MODEL_VISION : MODEL_TEXT;
  const messages = buildMessages(userText, files, ocrTexts);

  let lastErr: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${MISTRAL_API}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages:   [{ role: "system", content: systemPrompt }, ...messages],
          tools: [{
            type:     "function",
            function: {
              name:        toolName,
              description: toolDescription,
              parameters:  {
                type:                 "object",
                properties:           toolSchema,
                required:             toolRequired,
                additionalProperties: false,
              },
            },
          }],
          tool_choice: "any",
        }),
      });

      if (res.status === 529 || res.status === 503) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Mistral API ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = await res.json();
      const choice = json.choices?.[0];
      if (!choice) throw new Error("No choices in Mistral response");

      if (choice.finish_reason === "length")
        throw new Error(`Mistral output truncated — increase maxTokens (current: ${maxTokens})`);

      const toolCall = choice.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments)
        throw new Error(`No tool_call in Mistral response (finish_reason: ${choice.finish_reason})`);

      const args = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

      return args as Record<string, unknown>;

    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ── Plain text (used for unit detection) ─────────────────────────────────────

export interface CallAITextOptions {
  systemPrompt: string;
  userText:     string;
  files?:       FileContent[];
  maxTokens?:   number;
}

export async function callAIText(opts: CallAITextOptions): Promise<string> {
  const { systemPrompt, userText, files = [], maxTokens = 20 } = opts;
  const key = getKey();

  // Pre-process PDFs
  const ocrTexts = new Map<number, string>();
  for (let i = 0; i < files.length; i++) {
    if (files[i].type === "pdf") {
      ocrTexts.set(i, await ocrPdf((files[i] as { type: "pdf"; base64: string }).base64, key));
    }
  }

  const model    = needsVision(files) ? MODEL_VISION : MODEL_TEXT;
  const messages = buildMessages(userText, files, ocrTexts);

  const res = await fetch(`${MISTRAL_API}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages:   [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok) throw new Error(`Mistral API ${res.status}`);
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}
