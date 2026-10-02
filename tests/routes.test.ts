import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const analysisResult = {
  summary: "A calm flight.",
  themes: ["flight"],
  emotions: ["calm"],
  symbols: [],
  reflection: "Where do you feel free?",
  mood_after: "hopeful",
};

const analyzeMock = vi.fn();
vi.mock("@/lib/analysis/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/client")>();
  return {
    ...actual,
    analyzeDream: (...args: unknown[]) => analyzeMock(...args),
  };
});

import { GET as listDreams, POST as createDream } from "@/app/api/dreams/route";
import { GET as getDream, DELETE as deleteDream } from "@/app/api/dreams/[id]/route";
import { POST as analyzeRoute } from "@/app/api/dreams/[id]/analyze/route";
import { isActive, __setActiveForTest } from "@/lib/analysis-run";

let dir: string;
let repoToClose: ReturnType<typeof import("@/lib/dreams").createRepository> | null = null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-routes-"));
  process.env.DREAMBUDDY_DB_PATH = path.join(dir, "routes.db");
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  process.env.DREAMBUDDY_MODEL = "gpt-oss-120b";
  analyzeMock.mockReset();
  analyzeMock.mockResolvedValue(analysisResult);
});

afterEach(async () => {
  repoToClose?.close();
  repoToClose = null;
  const { closeRepository } = await import("@/lib/repository");
  closeRepository();
  fs.rmSync(dir, { recursive: true, force: true });
});

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestDream(overrides: Record<string, unknown> = {}) {
  const res = await createDream(
    post("http://localhost/api/dreams", {
      content: "I walked through a glass forest.",
      dreamDate: "2026-09-25",
      ...overrides,
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { dream: { id: string } };
}

describe("POST /api/dreams", () => {
  it("creates a dream and returns 201", async () => {
    const res = await createDream(
      post("http://localhost/api/dreams", {
        content: "I walked through a glass forest.",
        dreamDate: "2026-09-25",
        title: "Glass forest",
        mood: "awed",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { dream: Record<string, unknown> };
    expect(body.dream.content).toBe("I walked through a glass forest.");
    expect(body.dream.analysisStatus).toBe("none");
  });

  it("defaults the dream date to today", async () => {
    const res = await createDream(
      post("http://localhost/api/dreams", { content: "A dream without a date." }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { dream: { dreamDate: string } };
    expect(body.dream.dreamDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns 400 for empty content", async () => {
    const res = await createDream(
      post("http://localhost/api/dreams", { content: "", dreamDate: "2026-09-25" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await createDream2(
      "http://localhost/api/dreams",
      "{not json",
    );
    expect(res.status).toBe(400);
  });
});

async function createDream2(url: string, raw: string): Promise<Response> {
  return createDream(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
}

describe("GET /api/dreams", () => {
  it("returns an empty list initially", async () => {
    const res = await listDreams(new Request("http://localhost/api/dreams"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dreams: unknown[] };
    expect(body.dreams).toEqual([]);
  });

  it("returns created dreams newest first", async () => {
    const first = await createTestDream({ content: "First dream" });
    const second = await createTestDream({ content: "Second dream" });
    const res = await listDreams(new Request("http://localhost/api/dreams"));
    const body = (await res.json()) as { dreams: { id: string }[] };
    expect(body.dreams.map((d) => d.id)).toEqual([second.dream.id, first.dream.id]);
  });

  it("rejects a non-numeric limit", async () => {
    const res = await listDreams(new Request("http://localhost/api/dreams?limit=abc"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/dreams/[id]", () => {
  it("returns a dream by id", async () => {
    const { dream } = await createTestDream();
    const res = await getDream(new Request(`http://localhost/api/dreams/${dream.id}`), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dream: { id: string } };
    expect(body.dream.id).toBe(dream.id);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await getDream(new Request("http://localhost/api/dreams/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/dreams/[id]", () => {
  it("deletes an existing dream", async () => {
    const { dream } = await createTestDream();
    const res = await deleteDream(new Request(`http://localhost/api/dreams/${dream.id}`), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(res.status).toBe(204);
    const check = await getDream(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(check.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await deleteDream(new Request("http://localhost/api/dreams/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/dreams/[id]/analyze", () => {
  it("returns 503 not_configured when no API key is set", async () => {
    const { dream } = await createTestDream();
    const res = await analyzeRoute(
      new Request(`http://localhost/api/dreams/${dream.id}/analyze`, { method: "POST" }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_configured");
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("stores the analysis and returns 200 when configured", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { dream } = await createTestDream();
    const res = await analyzeRoute(
      new Request(`http://localhost/api/dreams/${dream.id}/analyze`, { method: "POST" }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dream: { analysisStatus: string; analysis: { summary: string } };
    };
    expect(body.dream.analysisStatus).toBe("done");
    expect(body.dream.analysis.summary).toBe(analysisResult.summary);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 upstream_error when the model call fails and keeps the dream analyzable", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { AiError } = await import("@/lib/analysis/client");
    analyzeMock.mockRejectedValue(
      new AiError("upstream_error", "The model returned a 500."),
    );
    const { dream } = await createTestDream();
    const res = await analyzeRoute(
      new Request(`http://localhost/api/dreams/${dream.id}/analyze`, { method: "POST" }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_error");
    expect(body.error.message).toContain("500");

    const detail = await getDream(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: dream.id }),
    });
    const detailBody = (await detail.json()) as {
      dream: { analysisStatus: string; analysisError: string };
    };
    expect(detailBody.dream.analysisStatus).toBe("failed");
    expect(detailBody.dream.analysisError).toContain("500");
  });

  it("returns 502 invalid_output when the model reply is unusable", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { AiError } = await import("@/lib/analysis/client");
    analyzeMock.mockRejectedValue(
      new AiError(
        "invalid_output",
        "Model reply failed validation: summary: Required",
      ),
    );
    const { dream } = await createTestDream();
    const res = await analyzeRoute(
      new Request(`http://localhost/api/dreams/${dream.id}/analyze`, { method: "POST" }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_output");
    expect(body.error.message).toContain("failed validation");

    const detail = await getDream(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: dream.id }),
    });
    const detailBody = (await detail.json()) as {
      dream: { analysisStatus: string; analysisError: string };
    };
    expect(detailBody.dream.analysisStatus).toBe("failed");
    expect(detailBody.dream.analysisError).toContain("failed validation");
  });

  it("returns 404 for an unknown id", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const res = await analyzeRoute(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 while a live in-process analysis is running", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { dream } = await createTestDream();
    let release!: (value: typeof analysisResult) => void;
    analyzeMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = analyzeRoute(analyzeRequest(dream.id), {
      params: Promise.resolve({ id: dream.id }),
    });
    await vi.waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(1));
    expect(isActive(dream.id)).toBe(true);

    const second = await analyzeRoute(analyzeRequest(dream.id), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("analysis_running");

    release(analysisResult);
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect(isActive(dream.id)).toBe(false);
  });

  it("returns 409 when the run registry marks the id active (test hook)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { dream } = await createTestDream();
    await markRunning(dream.id);
    __setActiveForTest(dream.id, true);
    try {
      const res = await analyzeRoute(analyzeRequest(dream.id), {
        params: Promise.resolve({ id: dream.id }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("analysis_running");
      expect(analyzeMock).not.toHaveBeenCalled();
    } finally {
      __setActiveForTest(dream.id, false);
    }
  });

  it("takes over a stale running row left by a died handler", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { dream } = await createTestDream();
    await markRunning(dream.id);

    const res = await analyzeRoute(analyzeRequest(dream.id), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dream: { analysisStatus: string; analysis: { summary: string } };
    };
    expect(body.dream.analysisStatus).toBe("done");
    expect(body.dream.analysis.summary).toBe(analysisResult.summary);
    expect(isActive(dream.id)).toBe(false);
  });

  it("marks a stale-takeover dream failed when the model call rejects", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { AiError } = await import("@/lib/analysis/client");
    analyzeMock.mockRejectedValue(
      new AiError("upstream_error", "The model returned a 500."),
    );
    const { dream } = await createTestDream();
    await markRunning(dream.id);

    const res = await analyzeRoute(analyzeRequest(dream.id), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(res.status).toBe(502);
    const detail = await getDream(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: dream.id }),
    });
    const detailBody = (await detail.json()) as {
      dream: { analysisStatus: string; analysisError: string };
    };
    expect(detailBody.dream.analysisStatus).toBe("failed");
    expect(detailBody.dream.analysisError).toContain("500");
    expect(isActive(dream.id)).toBe(false);
  });
});

function analyzeRequest(id: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost/api/dreams/${id}/analyze`, {
    method: "POST",
    headers,
  });
}

async function markRunning(id: string): Promise<void> {
  const { createRepository } = await import("@/lib/dreams");
  repoToClose = createRepository(process.env.DREAMBUDDY_DB_PATH as string);
  expect(repoToClose.startAnalysis(id)).toBe(true);
}

describe("cross-origin protection", () => {
  const evil = { origin: "http://evil.example" };

  it("rejects POST /api/dreams with a foreign Origin", async () => {
    const res = await createDream(
      post("http://localhost/api/dreams", {
        content: "Injected spam.",
        dreamDate: "2026-09-25",
      }),
    );
    const withOrigin = await createDream(
      new Request("http://localhost/api/dreams", {
        method: "POST",
        headers: { "content-type": "application/json", ...evil },
        body: JSON.stringify({ content: "Injected spam.", dreamDate: "2026-09-25" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(withOrigin.status).toBe(403);
    const body = (await withOrigin.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden_origin");

    const list = await listDreams(new Request("http://localhost/api/dreams"));
    const listBody = (await list.json()) as { dreams: unknown[] };
    expect(listBody.dreams).toHaveLength(1);
  });

  it("rejects POST /api/dreams/[id]/analyze with a foreign Origin", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { dream } = await createTestDream();
    const res = await analyzeRoute(analyzeRequest(dream.id, evil), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden_origin");
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("rejects DELETE /api/dreams/[id] with a foreign Origin", async () => {
    const { dream } = await createTestDream();
    const res = await deleteDream(
      new Request(`http://localhost/api/dreams/${dream.id}`, {
        method: "DELETE",
        headers: evil,
      }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden_origin");

    const check = await getDream(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(check.status).toBe(200);
  });

  it("allows a matching Origin on all three state-changing handlers", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const created = await createDream(
      new Request("http://localhost/api/dreams", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ content: "A same-origin dream.", dreamDate: "2026-09-25" }),
      }),
    );
    expect(created.status).toBe(201);
    const { dream } = (await created.json()) as { dream: { id: string } };

    const analyzed = await analyzeRoute(analyzeRequest(dream.id, { origin: "http://localhost" }), {
      params: Promise.resolve({ id: dream.id }),
    });
    expect(analyzed.status).toBe(200);

    const deleted = await deleteDream(
      new Request(`http://localhost/api/dreams/${dream.id}`, {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id: dream.id }) },
    );
    expect(deleted.status).toBe(204);
  });
});
