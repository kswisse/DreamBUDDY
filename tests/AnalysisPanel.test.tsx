// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import AnalysisPanel, { ANALYSIS_POST_TIMEOUT_MS } from "@/components/AnalysisPanel";
import type { Dream } from "@/lib/dreams";

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

function doneDream() {
  return {
    dream: {
      analysisStatus: "done",
      analysis,
      analysisError: "",
      model: "gpt-oss-120b",
      analyzedAt: "2026-09-26T00:00:00Z",
    },
  };
}

function runningDream() {
  return {
    dream: {
      analysisStatus: "running",
      analysis: null,
      analysisError: "",
      model: "",
      analyzedAt: null,
    },
  };
}

const baseProps = {
  dreamId: "d1",
  initialAnalysis: null,
  initialError: "",
  initialModel: "",
  initialAnalyzedAt: null,
};

describe("AnalysisPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers re-analysis when a done dream's stored interpretation is unreadable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(doneDream()));

    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="done"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    await screen.findByText(/stored interpretation could not be read/i);

    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Re-analyze" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dreams/d1/analyze", {
        method: "POST",
        signal: expect.any(AbortSignal),
      });
    });
    await screen.findByText("A quiet flight.");
  });

  it("auto-starts exactly once for a freshly recorded dream and renders the result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(doneDream()));

    const props = {
      dreamId: "d1",
      initialStatus: "none" as const,
      initialAnalysis: null,
      initialError: "",
      initialModel: "",
      initialAnalyzedAt: null,
      autoStart: true,
    };
    const { rerender } = render(<AnalysisPanel {...props} />);

    await screen.findByText("A quiet flight.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Analyzed")).toBeTruthy();

    rerender(<AnalysisPanel {...props} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("auto-starts exactly once under StrictMode's double-invoked effects", async () => {
    fetchMock.mockResolvedValue(jsonResponse(doneDream()));

    render(
      <StrictMode>
        <AnalysisPanel {...baseProps} initialStatus="none" autoStart />
      </StrictMode>,
    );

    await screen.findByText("A quiet flight.");
    expect(screen.getByText("Analyzed")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start when a completed analysis is already present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(doneDream()));

    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="done"
        initialAnalysis={analysis}
        initialError=""
        initialModel="gpt-oss-120b"
        initialAnalyzedAt="2026-09-26T00:00:00Z"
        autoStart
      />,
    );

    await screen.findByText("A quiet flight.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the setup hint when analysis is blocked by a missing API key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "not_configured",
            message:
              "OPENAI_API_KEY is not set. Add it to .env.local (see .env.example) to enable AI analysis.",
          },
        },
        503,
      ),
    );

    const { container } = render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
        autoStart
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(container.querySelector(".alert-error")?.textContent).toContain(
      "OPENAI_API_KEY is not set",
    );
    const hint = container.querySelector(".alert-info");
    expect(hint?.textContent).toContain("OPENAI_BASE_URL");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry analysis" }),
    ).toBeTruthy();
  });

  it("runs an analysis on demand, surfaces a failure, and recovers via retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "upstream_error", message: "boom" } }, 500),
      )
      .mockResolvedValueOnce(jsonResponse(doneDream()));

    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    await screen.findByText("boom");

    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    await screen.findByText("A quiet flight.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("surfaces a network failure when fetch rejects and recovers via retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("net down"))
      .mockResolvedValueOnce(jsonResponse(doneDream()));

    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

    await screen.findByText("Could not reach the server. Please try again.");
    const retry = screen.getByRole<HTMLButtonElement>("button", {
      name: "Retry analysis",
    });
    fireEvent.click(retry);

    await screen.findByText("A quiet flight.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Could not reach the server. Please try again.")).toBeNull();
    expect(screen.getByText("Analyzed")).toBeTruthy();
  });

  it("reports an unknown failure when the response body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));

    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

    await screen.findByText("Analysis failed for an unknown reason.");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry analysis" }),
    ).toBeTruthy();
  });

  it("polls an inherited running analysis until it finishes, without a remount", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(runningDream()))
      .mockResolvedValueOnce(jsonResponse(doneDream()));

    render(<AnalysisPanel {...baseProps} initialStatus="running" />);

    expect(screen.getByText(/Asking the model to interpret/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/Asking the model to interpret/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText("A quiet flight.")).toBeTruthy();
    expect(screen.getByText("Analyzed")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/dreams/d1", {
      signal: expect.any(AbortSignal),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the saved interpretation visible when a re-analysis fails", async () => {
    render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="failed"
        initialAnalysis={analysis}
        initialError="boom"
        initialModel="gpt-oss-120b"
        initialAnalyzedAt="2026-09-26T00:00:00Z"
      />,
    );

    expect(screen.getByText("boom")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry analysis" }),
    ).toBeTruthy();

    expect(screen.getByText("A quiet flight.")).toBeTruthy();
    expect(screen.getByText(/previously saved|last saved|still shows/i)).toBeTruthy();
  });

  it("bounds the analysis POST with a timeout signal and pins its budget", () => {
    // > 240_000 documented server-side retry budget, so the client never
    // gives up before the server could still answer.
    expect(ANALYSIS_POST_TIMEOUT_MS).toBe(300_000);
    expect(ANALYSIS_POST_TIMEOUT_MS).toBeGreaterThan(240_000);
  });

  it("surfaces the analysis_running 409 as a retryable failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "analysis_running",
            message: "An analysis is already running for this dream.",
          },
        },
        409,
      ),
    );

    const { container } = render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

    await screen.findByText("An analysis is already running for this dream.");
    expect(container.querySelector(".badge")?.textContent).toBe("Analysis failed");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry analysis" }),
    ).toBeTruthy();
  });

  it("shows only the plain message for a server-rendered failed dream", () => {
    // Pinning current behavior: `failure` starts null on a detail-page
    // reload, so the not_configured setup hint (failure?.code ===
    // "not_configured") is only reachable on a live failure code, never from
    // server-rendered initialError text alone.
    const { container } = render(
      <AnalysisPanel
        dreamId="d1"
        initialStatus="failed"
        initialAnalysis={null}
        initialError="OPENAI_API_KEY is not set. Add it to .env.local (see .env.example) to enable AI analysis."
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    expect(
      container.querySelector(".alert-error")?.textContent,
    ).toContain("OPENAI_API_KEY is not set");
    expect(container.querySelector(".alert-info")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry analysis" }),
    ).toBeTruthy();
  });

  it("renders a full Dream fixture from the route contract", async () => {
    // The explicit `Dream` annotation is the compile-time contract pin
    // between the analyze route (repo.get) and this panel; typecheck is the
    // enforcement layer for field renames.
    const fixture: Dream = {
      id: "d1",
      createdAt: "2026-09-25T10:00:00Z",
      dreamDate: "2026-09-25",
      title: "The quiet flight",
      content: "I floated over a still lake.",
      mood: "calm",
      analysisStatus: "done",
      analysisError: "",
      analysis,
      analyzedAt: "2026-09-26T00:00:00Z",
      model: "gpt-oss-120b",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ dream: fixture }));

    render(
      <AnalysisPanel
        dreamId={fixture.id}
        initialStatus="none"
        initialAnalysis={null}
        initialError=""
        initialModel=""
        initialAnalyzedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

    await screen.findByText("A quiet flight.");
    expect(screen.getByText(/gpt-oss-120b/)).toBeTruthy();
    expect(screen.getByText("Analyzed")).toBeTruthy();
  });
});
