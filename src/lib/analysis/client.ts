import {
  isConfigured,
  isOfficialEndpoint,
  DEFAULT_MODEL,
  type AppConfig,
} from "@/lib/config";
import { extractAnalysis, type DreamAnalysis } from "@/lib/analysis/schema";
import { buildPrompts } from "@/lib/analysis/prompt";
import type { CreateDreamInput } from "@/lib/dreams";

export type AiErrorCode = "not_configured" | "upstream_error" | "invalid_output";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export interface AnalyzeOptions {
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_ERROR_DETAIL_LENGTH = 160;
const MAX_TOKENS = 2000;
const TEMPERATURE = 0.3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Delay before retry `attempt` (1-based): the server's Retry-After header
 * when it is a usable number of seconds, otherwise exponential backoff on
 * `baseMs` with 0.5–1.5x jitter — both capped at 30 seconds.
 */
export function computeRetryDelayMs(
  attempt: number,
  baseMs: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
  }
  const exponential = baseMs * 2 ** (attempt - 1);
  if (exponential <= 0) return 0;
  const jittered = exponential * (0.5 + Math.random());
  return Math.min(Math.round(jittered), MAX_RETRY_DELAY_MS);
}

function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***");
}

/**
 * Drain an error response body and reduce it to a short, secret-free detail
 * line: the API's message field when present, the raw text otherwise.
 */
async function upstreamDetail(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return "";
  }
  text = text.trim();
  if (!text) return "";

  let detail = text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null) {
      const error = parsed.error;
      if (
        typeof error === "object" &&
        error !== null &&
        typeof (error as { message?: unknown }).message === "string"
      ) {
        detail = (error as { message: string }).message;
      } else if (typeof parsed.message === "string") {
        detail = parsed.message;
      } else if (typeof error === "string") {
        detail = error;
      } else if (typeof parsed.detail === "string") {
        detail = parsed.detail;
      } else {
        detail = "";
      }
    }
  } catch {
    // plain-text body — keep it
  }

  detail = redact(detail.replace(/\s+/g, " ").trim());
  if (detail.length > MAX_ERROR_DETAIL_LENGTH) {
    detail = `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`;
  }
  return detail;
}

function statusLine(response: Response, detail: string): string {
  return detail
    ? `Model endpoint returned HTTP ${response.status}: ${detail}`
    : `Model endpoint returned HTTP ${response.status}.`;
}

/**
 * Appended when a 400/404 error body mentions the model. On the official
 * endpoint it also names the classic trap: the default model is
 * served there only via the Responses API, not /chat/completions.
 */
function modelHint(status: number, detail: string, config: AppConfig): string {
  if (status !== 400 && status !== 404) return "";
  if (!/\bmodel\b/i.test(detail)) return "";
  const base = ` Check DREAMBUDDY_MODEL ("${config.model}"): the endpoint rejected this model id.`;
  return isOfficialEndpoint(config) && config.model === DEFAULT_MODEL
    ? `${base} ${DEFAULT_MODEL} runs on OpenAI-compatible servers (Ollama, vLLM, LM Studio, NVIDIA NIM…), not api.openai.com.`
    : base;
}

/**
 * Ask the configured OpenAI-compatible endpoint to interpret one dream.
 * Throws AiError with code:
 *  - not_configured: no API key and the official endpoint is in use
 *  - upstream_error:  HTTP failure after retries (or a non-retryable status)
 *  - invalid_output:  the model replied but not with a usable analysis
 */
export async function analyzeDream(
  dream: CreateDreamInput,
  config: AppConfig,
  options: AnalyzeOptions = {},
): Promise<DreamAnalysis> {
  if (!isConfigured(config)) {
    throw new AiError(
      "not_configured",
      "OPENAI_API_KEY is not set. Add it to .env.local (see .env.example) to enable AI analysis.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const { system, user } = buildPrompts(dream);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  // Ask for a structured reply; endpoints that reject response_format
  // (Ollama, older gateways) get one bare-payload retry on HTTP 400.
  let enhanced = true;
  let payload = JSON.stringify({
    model: config.model,
    messages,
    response_format: { type: "json_object" },
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  });
  const barePayload = JSON.stringify({ model: config.model, messages });

  let lastError = "The model endpoint did not respond.";
  let invalidRetries = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = `Could not reach the model endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`;
      if (attempt < maxAttempts) {
        const delay = computeRetryDelayMs(attempt, retryDelayMs, null);
        if (delay > 0) await sleep(delay);
        continue;
      }
      throw new AiError("upstream_error", lastError);
    }

    if (!response.ok) {
      const detail = await upstreamDetail(response);
      lastError = statusLine(response, detail) + modelHint(response.status, detail, config);

      if (enhanced && response.status === 400) {
        enhanced = false;
        payload = barePayload;
        continue;
      }

      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        const delay = computeRetryDelayMs(
          attempt,
          retryDelayMs,
          response.headers.get("retry-after"),
        );
        if (delay > 0) await sleep(delay);
        continue;
      }
      throw new AiError("upstream_error", lastError);
    }

    let content: unknown;
    try {
      const body = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      content = body.choices?.[0]?.message?.content;
    } catch {
      throw new AiError("upstream_error", "Model endpoint returned invalid JSON.");
    }

    const retryInvalid = (): boolean => {
      if (invalidRetries >= 1 || attempt >= maxAttempts) return false;
      invalidRetries++;
      return true;
    };

    if (typeof content !== "string" || content.trim() === "") {
      if (retryInvalid()) {
        const delay = computeRetryDelayMs(attempt, retryDelayMs, null);
        if (delay > 0) await sleep(delay);
        continue;
      }
      throw new AiError(
        "invalid_output",
        "The model did not return an analysis. Try again.",
      );
    }

    try {
      return extractAnalysis(content);
    } catch (err) {
      if (retryInvalid()) {
        const delay = computeRetryDelayMs(attempt, retryDelayMs, null);
        if (delay > 0) await sleep(delay);
        continue;
      }
      throw new AiError(
        "invalid_output",
        err instanceof Error ? err.message : "The model returned an unusable analysis.",
      );
    }
  }

  throw new AiError("upstream_error", lastError);
}
