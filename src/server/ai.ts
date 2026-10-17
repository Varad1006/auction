import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { retryAfterSeconds } from "@/lib/insights";

// Which AI writes the scouting notes. Groq's free tier (a Qwen model) is the
// default when GROQ_API_KEY is set; Claude is used when only
// ANTHROPIC_API_KEY is set, or when AI_PROVIDER=anthropic.

export type Provider = "groq" | "anthropic";

export class AiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Seconds to wait before trying again (rate limits). */
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export const ANTHROPIC_MODEL = "claude-opus-5-5";
const DEFAULT_GROQ_MODEL = "qwen/qwen3-32b";
/** Give up before the platform stops the function (60 s). */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 50_000;

export function aiProvider(): Provider | null {
  const pick = process.env.AI_PROVIDER?.trim().toLowerCase();
  const groq = !!process.env.GROQ_API_KEY;
  const claude = !!process.env.ANTHROPIC_API_KEY;
  if (pick === "anthropic" && claude) return "anthropic";
  if (pick === "groq" && groq) return "groq";
  return groq ? "groq" : claude ? "anthropic" : null;
}

/** Players per request: small for Groq's free per-minute token limit. */
export function batchSizeFor(provider: Provider | null): number {
  return provider === "anthropic" ? 4 : 3;
}

/** Seconds between background requests: Groq's free tier allows a few a minute. */
export function backgroundGapFor(provider: Provider | null): number {
  // AI_BACKGROUND_GAP_S: only for tests against a fake AI.
  const set = Number(process.env.AI_BACKGROUND_GAP_S);
  if (process.env.AI_BACKGROUND_GAP_S && Number.isFinite(set) && set >= 0) return set;
  return provider === "anthropic" ? 10 : 30;
}

export function modelName(provider: Provider | null): string | null {
  if (provider === "anthropic") return ANTHROPIC_MODEL;
  if (provider === "groq") return groqModel ?? process.env.GROQ_MODEL?.trim() ?? DEFAULT_GROQ_MODEL;
  return null;
}

export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** Players in the request: sizes the answer Groq may write. */
  players: number;
  /** Give up sooner than the default (for requests inside a shorter function). */
  timeoutMs?: number;
}

/** Asks the model for a JSON object; returns the raw reply text. */
export async function completeJson(provider: Provider, req: JsonRequest): Promise<{ text: string; model: string }> {
  return provider === "groq" ? groqJson(req) : anthropicJson(req);
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible chat completions)
// ---------------------------------------------------------------------------

const groqBase = () => (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");
let groqModel: string | null = null;

async function groqFetch(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(`${groqBase()}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new AiError(504, "ai_timeout", "The AI took too long. Try again.");
    throw new AiError(502, "ai_unreachable", "Couldn't reach Groq. Try again.");
  }
}

/** The best Qwen model Groq offers today (model names change over time). */
async function pickGroqModel(): Promise<string> {
  const res = await groqFetch("/models", { method: "GET" });
  const ids: string[] = res.ok ? ((await res.json())?.data ?? []).map((m: { id: string }) => m.id) : [];
  const qwen = ids.filter((id) => /qwen/i.test(id));
  const size = (id: string) => Number(/(\d+)b/i.exec(id)?.[1] ?? 0);
  const best = qwen.sort((a, b) => size(b) - size(a))[0];
  if (!best) throw new AiError(502, "ai_model_missing", "Groq has no Qwen model available right now. Set GROQ_MODEL in Vercel to a model Groq lists.");
  return best;
}

async function groqJson(req: JsonRequest): Promise<{ text: string; model: string }> {
  let model = modelName("groq")!;
  let reasoningOff = /qwen3|qwq/i.test(model);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await groqFetch("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        // Groq counts this towards the free per-minute token limit: room for
        // these players' notes, no more.
        max_completion_tokens: 400 + 450 * Math.max(req.players, 1),
        // Qwen 3 thinks out loud by default: off keeps replies short and inside the free limits.
        ...(reasoningOff ? { reasoning_effort: "none" } : {}),
      }),
    }, req.timeoutMs);
    const body = await res.json().catch(() => null);
    const message: string = body?.error?.message ?? "";
    if (res.ok) {
      const choice = body?.choices?.[0];
      if (choice?.finish_reason === "length") throw new AiError(502, "ai_too_long", "The AI's answer was cut off. Try again.");
      const text = choice?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new AiError(502, "ai_empty", "The AI returned an empty answer. Try again.");
      groqModel = model;
      return { text, model };
    }
    if (res.status === 429) {
      const wait = retryAfterSeconds(res.headers.get("retry-after"), message);
      throw new AiError(429, "ai_rate_limited", "Groq's free limit is reached for now.", wait ?? 30);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiError(502, "ai_key_rejected", "Groq rejected the API key. Check GROQ_API_KEY in Vercel.");
    }
    if ((res.status === 404 || body?.error?.code === "model_not_found") && !process.env.GROQ_MODEL && attempt === 0) {
      model = await pickGroqModel();
      reasoningOff = /qwen3|qwq/i.test(model);
      continue;
    }
    if (res.status === 400 && reasoningOff && /reasoning/i.test(message)) {
      reasoningOff = false;
      continue;
    }
    if (res.status === 404 || body?.error?.code === "model_not_found") {
      throw new AiError(502, "ai_model_missing", `Groq doesn't offer the model "${model}". Set GROQ_MODEL in Vercel to one it lists.`);
    }
    if (res.status >= 500) throw new AiError(503, "ai_busy", "Groq is busy right now. Try again shortly.");
    console.error("Groq error", res.status, message);
    throw new AiError(502, "ai_rejected", `Groq rejected the request (${res.status}).`);
  }
  throw new AiError(502, "ai_rejected", "Groq rejected the request.");
}

// ---------------------------------------------------------------------------
// Claude (Anthropic)
// ---------------------------------------------------------------------------

async function anthropicJson(req: JsonRequest): Promise<{ text: string; model: string }> {
  // One attempt per request: callers retry later, and a function has 60 s.
  const client = new Anthropic({ timeout: req.timeoutMs ?? TIMEOUT_MS, maxRetries: 0 });
  try {
    const response = await client.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    if (response.stop_reason === "refusal") throw new AiError(502, "ai_refused", "The AI declined to answer. Try again.");
    if (response.stop_reason === "max_tokens") throw new AiError(502, "ai_too_long", "The AI's answer was cut off. Try again.");
    return { text: response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""), model: ANTHROPIC_MODEL };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new AiError(502, "ai_key_rejected", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.");
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new AiError(429, "ai_rate_limited", "The AI is rate-limited right now.", retryAfterSeconds(e.headers?.get?.("retry-after") ?? null, "") ?? 30);
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError(504, "ai_timeout", "The AI took too long. Try again.");
    if (e instanceof Anthropic.APIConnectionError) throw new AiError(502, "ai_unreachable", "Couldn't reach the AI service. Try again.");
    if (e instanceof Anthropic.InternalServerError) throw new AiError(503, "ai_busy", "The AI service is busy. Try again shortly.");
    if (e instanceof Anthropic.APIError) {
      console.error("AI error", e.status, e.message);
      throw new AiError(502, "ai_rejected", `The AI service returned an error (${e.status ?? "unknown"}).`);
    }
    throw e;
  }
}
