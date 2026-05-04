/**
 * Rehbar AI client — Claude Sonnet 4.6 only.
 * Model selection is an infrastructure concern, not a caller concern.
 * All extraction and generation in this codebase runs through this module.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

const CLAUDE_MODEL  = "claude-sonnet-4-6";
const CLAUDE_API    = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER = "2023-06-01";

// ── File content types ────────────────────────────────────────────────────────

export type FileContent =
  | { type: "pdf";   base64: string }
  | { type: "image"; base64: string; mime: string }
  | { type: "text";  text: string };

function toBlock(f: FileContent) {
  if (f.type === "text") return { type: "text", text: f.text };
  if (f.type === "pdf")  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } };
  return                        { type: "image",    source: { type: "base64", media_type: f.mime,            data: f.base64 } };
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
}

export async function callAI(opts: CallAIOptions): Promise<Record<string, unknown>> {
  const {
    systemPrompt, userText, files = [],
    toolName, toolDescription, toolSchema, toolRequired = [],
    maxTokens = 8192, retries = 2,
  } = opts;

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret not set in Supabase");

  let lastErr: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(CLAUDE_API, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VER,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: [{ type: "text", text: userText }, ...files.map(toBlock)],
          }],
          tools: [{
            name: toolName,
            description: toolDescription,
            input_schema: {
              type: "object",
              properties: toolSchema,
              required: toolRequired,
              additionalProperties: false,
            },
          }],
          tool_choice: { type: "tool", name: toolName },
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
      const block = (json.content as { type: string; input?: unknown }[])
        ?.find(c => c.type === "tool_use");
      if (!block?.input) throw new Error(`No tool_use block in Claude response (stop_reason: ${json.stop_reason})`);
      return block.input as Record<string, unknown>;

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
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret not set in Supabase");

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VER,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 20,
      system: opts.systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: opts.userText },
          ...(opts.files ?? []).map(toBlock),
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const json = await res.json();
  return (json.content?.[0]?.text ?? "").trim();
}
