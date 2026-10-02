"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DreamAnalysis } from "@/lib/analysis/schema";
import { STATUS_LABEL, type AnalysisStatus as Status } from "@/lib/status";

interface Props {
  dreamId: string;
  initialStatus: Status;
  initialAnalysis: DreamAnalysis | null;
  initialError: string;
  initialModel: string;
  initialAnalyzedAt: string | null;
  autoStart?: boolean;
}

interface ApiFailure {
  code: string;
  message: string;
}

interface DreamSnapshot {
  analysisStatus: Status;
  analysis: DreamAnalysis | null;
  analysisError: string;
  model: string;
  analyzedAt: string | null;
}

const POLL_INTERVAL_MS = 2000;

function AnalysisBody({ analysis }: { analysis: DreamAnalysis }) {
  return (
    <>
      <div className="analysis-block">
        <h4>Summary</h4>
        <p style={{ margin: 0 }}>{analysis.summary}</p>
      </div>
      <div className="analysis-block">
        <h4>Themes</h4>
        <div className="chip-row">
          {analysis.themes.map((theme) => (
            <span key={theme} className="chip">
              {theme}
            </span>
          ))}
        </div>
      </div>
      <div className="analysis-block">
        <h4>Emotions</h4>
        <div className="chip-row">
          {analysis.emotions.map((emotion) => (
            <span key={emotion} className="chip">
              {emotion}
            </span>
          ))}
        </div>
      </div>
      {analysis.symbols.length > 0 && (
        <div className="analysis-block">
          <h4>Symbols</h4>
          {analysis.symbols.map((symbol) => (
            <p key={symbol.name} className="symbol" style={{ margin: "0 0 8px" }}>
              <b>{symbol.name}</b> — {symbol.meaning}
            </p>
          ))}
        </div>
      )}
      <div className="analysis-block">
        <h4>Reflection</h4>
        <p className="reflection" style={{ margin: 0 }}>
          {analysis.reflection}
        </p>
      </div>
      <div className="analysis-block" style={{ marginBottom: 0 }}>
        <h4>How this lands</h4>
        <div className="chip-row">
          <span className="chip">{analysis.mood_after}</span>
        </div>
      </div>
    </>
  );
}

export default function AnalysisPanel({
  dreamId,
  initialStatus,
  initialAnalysis,
  initialError,
  initialModel,
  initialAnalyzedAt,
  autoStart = false,
}: Props) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [analysis, setAnalysis] = useState<DreamAnalysis | null>(initialAnalysis);
  const [error, setError] = useState<string>(initialError);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [model, setModel] = useState(initialModel);
  const [analyzedAt, setAnalyzedAt] = useState(initialAnalyzedAt);
  const autoStarted = useRef(false);
  const analysisRequest = useRef(false);

  const runAnalysis = useCallback(async () => {
    setStatus("running");
    setError("");
    setFailure(null);
    analysisRequest.current = true;
    try {
      const res = await fetch(`/api/dreams/${dreamId}/analyze`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | {
            dream?: {
              analysisStatus: Status;
              analysis: DreamAnalysis | null;
              analysisError: string;
              model: string;
              analyzedAt: string | null;
            };
            error?: ApiFailure;
          }
        | null;

      if (res.ok && body?.dream) {
        setAnalysis(body.dream.analysis);
        setStatus(body.dream.analysisStatus);
        setModel(body.dream.model);
        setAnalyzedAt(body.dream.analyzedAt);
        return;
      }

      if (body?.error) {
        setFailure(body.error);
        setError(body.error.message);
      } else {
        setError("Analysis failed for an unknown reason.");
      }
      setStatus("failed");
    } catch {
      setFailure(null);
      setError("Could not reach the server. Please try again.");
      setStatus("failed");
    } finally {
      analysisRequest.current = false;
    }
  }, [dreamId]);

  useEffect(() => {
    // Auto-analyze only when explicitly requested (freshly recorded dream)
    // and there is no completed analysis to show yet.
    if (autoStart && !autoStarted.current && initialAnalysis === null) {
      autoStarted.current = true;
      void runAnalysis();
    }
  }, [autoStart, initialAnalysis, runAnalysis]);

  useEffect(() => {
    // A running row (this tab's own analysis, or one inherited from a page
    // reload) only resolves if something keeps reading the dream. Poll the
    // stored row until it leaves "running", then map it into local state.
    if (status !== "running") return;

    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      // Never let a poll clobber state owned by an in-flight POST.
      if (analysisRequest.current) return;
      try {
        const res = await fetch(`/api/dreams/${dreamId}`, {
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => null)) as
          | { dream?: DreamSnapshot }
          | null;
        if (cancelled || !res.ok || !body?.dream) return;
        const dream = body.dream;
        if (dream.analysisStatus === "running") return;
        setAnalysis(dream.analysis);
        setStatus(dream.analysisStatus);
        setError(dream.analysisError);
        setFailure(null);
        setModel(dream.model);
        setAnalyzedAt(dream.analyzedAt);
      } catch {
        // Aborted on cleanup, or a transient network error: retry on the
        // next tick while the row is still running.
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [status, dreamId]);

  return (
    <section className="card" aria-live="polite">
      <div className="dream-meta" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Interpretation</h2>
        <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
      </div>

      {status === "running" && (
        <p className="muted" style={{ margin: 0 }}>
          <span className="spinner" aria-hidden="true" />
          Asking the model to interpret this dream…
        </p>
      )}

      {status === "none" && (
        <div>
          <p className="muted" style={{ marginTop: 0 }}>
            This dream has not been analyzed yet.
          </p>
          <button type="button" className="primary" onClick={() => void runAnalysis()}>
            Analyze now
          </button>
        </div>
      )}

      {status === "failed" && (
        <div>
          <div className="alert alert-error">{error || "Analysis failed."}</div>
          {failure?.code === "not_configured" && (
            <div className="alert alert-info">
              Copy <code>.env.example</code> to <code>.env.local</code>, set{" "}
              <code>OPENAI_API_KEY</code>, and restart the server. Any
              OpenAI-compatible endpoint works via <code>OPENAI_BASE_URL</code>.
            </div>
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => void runAnalysis()}
            >
              Retry analysis
            </button>
          </div>
          {analysis && (
            <div>
              <p className="muted small" style={{ margin: "12px 0 0" }}>
                Showing the last saved interpretation — the latest analysis
                attempt failed.
              </p>
              <AnalysisBody analysis={analysis} />
            </div>
          )}
        </div>
      )}

      {status === "done" && !analysis && (
        <div>
          <div className="alert alert-error">
            The stored interpretation could not be read. Re-analyze to
            regenerate it.
          </div>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => void runAnalysis()}
            >
              Re-analyze
            </button>
          </div>
        </div>
      )}

      {status === "done" && analysis && (
        <div>
          <AnalysisBody analysis={analysis} />
          <div className="button-row" style={{ marginBottom: 0 }}>
            <button type="button" onClick={() => void runAnalysis()}>
              Re-analyze
            </button>
            <span className="muted small">
              {model}
              {analyzedAt ? ` · ${analyzedAt.slice(0, 10)}` : ""}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
