import { describe, it, expect, vi, afterEach } from "vitest";
import {
  analyzeDream,
  AiError,
  computeRetryDelayMs,
} from "@/lib/analysis/client";
import { loadConfig } from "@/lib/config";

const analysis = {
  summary: "A quiet flight.",
  themes: ["flight"],
  emotions: ["calm"],
  symbols: [],
  reflection: "Where do you feel free?",
  mood_after: "hopeful",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completionResponse(content: string): Response {
  return jsonResponse({
    choices: [{ message: { role: "assistant", content } }],
  });
}

const dream = {
  content: "I flew over the town.",
  dreamDate: "2026-09-25",
  title: "Flight",
  mood: "calm",
};

describe("analyzeDream", () => {
  it("sends a chat-completions request with the configured model and prompts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const result = await analyzeDream(dream, config, { fetchImpl: fetchMock });

    expect(result).toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test",
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-oss-120b");
    const system = body.messages.find((m: { role: string }) => m.role === "system");
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(system?.content).toMatch(/dream/i);
    expect(user?.content).toContain("I flew over the town.");
    expect(user?.content).toContain("2026-09-25");
  });

  it("honours OPENAI_BASE_URL for self-hosted servers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_BASE_URL: "http://localhost:11434/v1" });

    await analyzeDream(dream, config, { fetchImpl: fetchMock });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("fails fast with not_configured when the official endpoint has no key", async () => {
    const fetchMock = vi.fn();
    const config = loadConfig({});

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once on a transient 500 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const result = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    });

    expect(result.summary).toBe(analysis.summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with upstream_error after exhausting retries on 500s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: "upstream_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up on a persistent 400 after dropping response_format once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: "upstream_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.response_format).toBeUndefined();
  });

  it("wraps network failures as upstream_error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: "upstream_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails fast with upstream_error when a 200 response body is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>bad gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("upstream_error");
    expect((err as AiError).message).toContain("invalid JSON");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-JSON model reply with invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(completionResponse("I cannot help with that.")),
      );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("exposes AiError with a human-readable message", async () => {
    const config = loadConfig({});
    let caught: unknown;
    try {
      await analyzeDream(dream, config, { fetchImpl: vi.fn() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect((caught as AiError).message).toMatch(/OPENAI_API_KEY/);
  });

  it("asks the endpoint for a JSON object and bounds the reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await analyzeDream(dream, config, { fetchImpl: fetchMock });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(typeof body.temperature).toBe("number");
    expect(typeof body.max_tokens).toBe("number");
  });

  it("retries bare when the endpoint rejects response_format with 400", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "response_format is not supported" } },
          400,
        ),
      )
      .mockResolvedValueOnce(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const result = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    });

    expect(result.summary).toBe(analysis.summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.response_format).toEqual({ type: "json_object" });
    expect(second.response_format).toBeUndefined();
    expect(second.temperature).toBeUndefined();
    expect(second.max_tokens).toBeUndefined();
  });

  it("drains, redacts and truncates the upstream error body", async () => {
    const leak = "sk-SECRETSECRETSECRET";
    const detail = `Invalid API key ${leak}. ` + "x".repeat(600);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: detail } }, 401));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    let caught: unknown;
    try {
      await analyzeDream(dream, config, {
        fetchImpl: fetchMock,
        retryDelayMs: 0,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AiError);
    expect((caught as AiError).code).toBe("upstream_error");
    const message = (caught as AiError).message;
    expect(message).toContain("HTTP 401");
    expect(message).toContain("Invalid API key");
    expect(message).toContain("sk-***");
    expect(message).not.toContain(leak);
    expect(message).not.toContain("x".repeat(200));
    expect(message.length).toBeLessThan(500);
  });

  it("falls back to the plain response text when the error body is not JSON", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response("upstream exploded", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    let caught: unknown;
    try {
      await analyzeDream(dream, config, {
        fetchImpl: fetchMock,
        retryDelayMs: 0,
      });
    } catch (err) {
      caught = err;
    }

    expect((caught as AiError).code).toBe("upstream_error");
    expect((caught as AiError).message).toContain("upstream exploded");
  });

  it("appends a DREAMBUDDY_MODEL hint when the endpoint rejects the model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              "The model 'gpt-oss-120b' does not exist or you do not have access to it.",
          },
        },
        404,
      ),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    let caught: unknown;
    try {
      await analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AiError);
    const message = (caught as AiError).message;
    expect(message).toContain("HTTP 404");
    expect(message).toContain("does not exist");
    expect(message).toContain("DREAMBUDDY_MODEL");
    expect(message).toContain("gpt-oss-120b");
    expect(message).toContain("not api.openai.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a string-valued error body so the model hint survives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "model 'gpt-oss-120b' not found" }, 404),
      );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("model 'gpt-oss-120b' not found");
    expect(message).toContain("DREAMBUDDY_MODEL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits the api.openai.com remark on a custom endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              "The model 'gpt-oss-120b' does not exist or you do not have access to it.",
          },
        },
        404,
      ),
    );
    const config = loadConfig({ OPENAI_BASE_URL: "http://localhost:11434/v1" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("HTTP 404");
    expect(message).toContain("DREAMBUDDY_MODEL");
    expect(message).not.toContain("api.openai.com");
  });

  it("does not mention gpt-oss-120b when a custom model is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              "The model 'gpt-5-mini' does not exist or you do not have access to it.",
          },
        },
        404,
      ),
    );
    const config = loadConfig({
      OPENAI_API_KEY: "sk-test",
      DREAMBUDDY_MODEL: "gpt-5-mini",
    });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("HTTP 404");
    expect(message).toContain("DREAMBUDDY_MODEL");
    expect(message).not.toContain("gpt-oss-120b");
  });

  it("does not add the model hint for client errors unrelated to the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "Unknown request URL." } }, 404),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    let caught: unknown;
    try {
      await analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 });
    } catch (err) {
      caught = err;
    }

    expect((caught as AiError).code).toBe("upstream_error");
    expect((caught as AiError).message).not.toContain("DREAMBUDDY_MODEL");
  });

  it("does not add the model hint for retryable statuses that mention the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "model temporarily overloaded" } }, 503),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    let caught: unknown;
    try {
      await analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 });
    } catch (err) {
      caught = err;
    }

    expect((caught as AiError).code).toBe("upstream_error");
    expect((caught as AiError).message).toContain("HTTP 503");
    expect((caught as AiError).message).not.toContain("DREAMBUDDY_MODEL");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries invalid model output once before giving up", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completionResponse("not json at all"))
      .mockResolvedValueOnce(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const result = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    });

    expect(result.summary).toBe(analysis.summary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with invalid_output after the single retry", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(completionResponse("still nothing usable")),
      );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await expect(
      analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: "invalid_output" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a top-level message string from a JSON error body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "quota exhausted for this key" }, 401));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("upstream_error");
    expect((err as AiError).message).toContain("HTTP 401");
    expect((err as AiError).message).toContain("quota exhausted for this key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a top-level detail string from a JSON error body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "request body was rejected" }, 401));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("upstream_error");
    expect((err as AiError).message).toContain("HTTP 401");
    expect((err as AiError).message).toContain("request body was rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts a Bearer token that leaks into the error body", async () => {
    const token = "sk-abc123secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: `Authorization failed for Bearer ${token}` }, 401),
      );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("HTTP 401");
    expect(message).toContain("Bearer ***");
    expect(message).not.toContain(token);
    expect(message).not.toContain("abc123secret");
  });

  it("appends the model hint when a 400 body mentions the configured model", async () => {
    // fresh Response per attempt: a 400 body is drained once per try
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { detail: "The model gpt-oss-120b is not supported by this endpoint." },
          400,
        ),
      ),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("HTTP 400");
    expect(message).toContain(
      "The model gpt-oss-120b is not supported by this endpoint.",
    );
    expect(message).toContain(
      'Check DREAMBUDDY_MODEL ("gpt-oss-120b"): the endpoint rejected this model id.',
    );
    expect(message).toContain(
      "gpt-oss-120b runs on OpenAI-compatible servers (Ollama, vLLM, LM Studio, NVIDIA NIM…), not api.openai.com.",
    );
    // 400 drops response_format once before the throw, so two attempts
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps a multi-kilobyte text/plain error body at 160 characters", async () => {
    const tail = "TAIL_MARKER_7f3ac9";
    const body = `ERR_UPSTREAM: ${"a".repeat(4096)} ${tail}`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 401,
        headers: { "content-type": "text/plain" },
      }),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    // status-line prefix + a body prefix proves the plain-text path ran
    expect(message).toContain("Model endpoint returned HTTP 401: ERR_UPSTREAM:");
    expect(message).toContain(body.slice(0, 100));
    // the cap keeps the multi-KB tail out of the surfaced message
    expect(message).not.toContain(tail);
    expect(message).not.toContain("a".repeat(200));
    // Bound: 34 ("Model endpoint returned HTTP 401: ")
    //      + 161 (MAX_ERROR_DETAIL_LENGTH 160 + the "…" ellipsis)
    //      +   0 (modelHint only fires for HTTP 400/404)
    //      = 195
    expect(message.length).toBeLessThanOrEqual(195);
  });

  it("bounds the combined cap-plus-hint message stored as analysis_error", async () => {
    // Worst case: HTTP 400 whose detail both hits the 160-char cap and
    // triggers modelHint, so status-line + cap + full official hint all land
    // in the single message that failAnalysis persists and the UI renders.
    const detail = `Unsupported model gpt-oss-120b parameter: ${"z".repeat(500)}`;
    // fresh Response per attempt: a 400 body is drained once per try
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ message: detail }, 400)),
    );
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    const err = await analyzeDream(dream, config, {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiError);
    const message = (err as AiError).message;
    expect(message).toContain("HTTP 400");
    expect(message).toContain("DREAMBUDDY_MODEL");
    expect(message).toContain("not api.openai.com");
    // 160-char cap − 42-char prefix leaves ≤ 118 z's, never 120
    expect(message).not.toContain("z".repeat(120));
    // Derived bound:
    //   34  status-line prefix ("Model endpoint returned HTTP 400: ")
    // + 161 capped detail (MAX_ERROR_DETAIL_LENGTH 160 + "…")
    // + 185 modelHint (78-char base + 107-char official-endpoint remark)
    // = 380 → assert against 400
    expect(message.length).toBeLessThanOrEqual(400);
    // 400 drops response_format once before the throw, so two attempts
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("analyzeDream upstream timeout protection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const timeoutError = (): DOMException =>
    new DOMException("The operation was aborted due to timeout", "TimeoutError");

  it("passes an AbortSignal to every attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(completionResponse(JSON.stringify(analysis)));
    const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

    await analyzeDream(dream, config, { fetchImpl: fetchMock, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const inits = fetchMock.mock.calls.map(([, init]) => init as RequestInit);
    for (const init of inits) {
      expect(init).toEqual(
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    }
  });

  it("recovers when the first attempt is aborted by the request timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(timeoutError())
        .mockResolvedValueOnce(completionResponse(JSON.stringify(analysis)));
      const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

      const pending = analyzeDream(dream, config, { fetchImpl: fetchMock });
      // attempt-1 backoff is 500ms * 0.5–1.5 jitter → ≤ 750ms of virtual time;
      // the repeats flush later microtasks (json() of the winning response)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(500);

      const result = await pending;
      expect(result.summary).toBe(analysis.summary);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with upstream_error when every attempt times out", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockImplementation(() => Promise.reject(timeoutError()));
      const config = loadConfig({ OPENAI_API_KEY: "sk-test" });

      const pending = analyzeDream(dream, config, { fetchImpl: fetchMock }).catch(
        (e: unknown) => e,
      );
      // attempt-1 backoff ≤ 750ms, attempt-2 backoff ≤ 1500ms, so 20s of
      // virtual time clears the whole 3-attempt budget instantly
      for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(500);

      const err = await pending;
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe("upstream_error");
      expect((err as AiError).message).toContain("Could not reach the model endpoint");
      expect((err as AiError).message).toContain("timeout");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("computeRetryDelayMs", () => {
  it("grows exponentially with jitter", () => {
    for (let i = 0; i < 20; i++) {
      const first = computeRetryDelayMs(1, 100, null);
      expect(first).toBeGreaterThanOrEqual(50);
      expect(first).toBeLessThanOrEqual(150);

      const third = computeRetryDelayMs(3, 100, null);
      expect(third).toBeGreaterThanOrEqual(200);
      expect(third).toBeLessThanOrEqual(600);
    }
  });

  it("stays at zero when the base delay is zero", () => {
    expect(computeRetryDelayMs(1, 0, null)).toBe(0);
    expect(computeRetryDelayMs(3, 0, null)).toBe(0);
  });

  it("caps every delay at 30 seconds", () => {
    expect(computeRetryDelayMs(10, 60_000, null)).toBe(30_000);
    expect(computeRetryDelayMs(1, 100, "120")).toBe(30_000);
  });

  it("honours a numeric Retry-After header", () => {
    expect(computeRetryDelayMs(1, 100, "5")).toBe(5_000);
    expect(computeRetryDelayMs(1, 100, "0")).toBe(0);
  });

  it("falls back to backoff for an unusable Retry-After header", () => {
    const delay = computeRetryDelayMs(1, 100, "not-a-number");
    expect(delay).toBeGreaterThanOrEqual(50);
    expect(delay).toBeLessThanOrEqual(150);
  });
});
