/**
 * Rehbar AI client — Anthropic Claude (Haiku).
 * - PDFs: sent natively as document blocks (no separate OCR step)
 * - Images: sent as base64 image blocks
 * - Text/Excel: sent as text content
 * All extraction and generation in this codebase runs through this module.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

const ANTHROPIC_API     = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL             = "claude-sonnet-4-6";

// ── File content types ────────────────────────────────────────────────────────

export type FileContent =
  | { type: "pdf";   base64: string }
  | { type: "image"; base64: string; mime: string }
  | { type: "text";  text: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

function getKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret not set in Supabase");
  return key;
}

/** Build Claude messages array from FileContent list + user text. */
function buildMessages(
  userText: string,
  files: FileContent[],
): { role: string; content: unknown }[] {
  const content: unknown[] = [{ type: "text", text: userText }];

  for (const f of files) {
    if (f.type === "text") {
      content.push({ type: "text", text: f.text });
    } else if (f.type === "pdf") {
      content.push({
        type:   "document",
        source: { type: "base64", media_type: "application/pdf", data: f.base64 },
      });
    } else if (f.type === "image") {
      content.push({
        type:   "image",
        source: { type: "base64", media_type: f.mime, data: f.base64 },
      });
    }
  }

  return [{ role: "user", content }];
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

  const key      = getKey();
  const messages = buildMessages(userText, files);

  let lastErr: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${ANTHROPIC_API}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "x-api-key":         key,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type":      "application/json",
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: maxTokens,
          system:     systemPrompt,
          messages,
          tools: [{
            name:         toolName,
            description:  toolDescription,
            input_schema: {
              type:       "object",
              properties: toolSchema,
              required:   toolRequired,
            },
          }],
          tool_choice: { type: "any" },
        }),
      });

      if (res.status === 529 || res.status === 503) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = await res.json();

      if (json.stop_reason === "max_tokens")
        throw new Error(`Claude output truncated — increase maxTokens (current: ${maxTokens})`);

      const toolUse = (json.content as { type: string; input?: unknown }[] ?? [])
        .find(b => b.type === "tool_use");
      if (!toolUse?.input)
        throw new Error(`No tool_use in Claude response (stop_reason: ${json.stop_reason})`);

      return toolUse.input as Record<string, unknown>;

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
  const key      = getKey();
  const messages = buildMessages(userText, files);

  const res = await fetch(`${ANTHROPIC_API}/messages`, {
    method: "POST",
    headers: {
      "x-api-key":         key,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type":      "application/json",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const json = await res.json();
  const textBlock = (json.content as { type: string; text?: string }[] ?? [])
    .find(b => b.type === "text");
  return (textBlock?.text ?? "").trim();
}
