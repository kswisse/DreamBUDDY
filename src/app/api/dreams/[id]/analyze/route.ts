import { getRepository } from "@/lib/repository";
import { loadConfig, isConfigured } from "@/lib/config";
import { analyzeDream, AiError } from "@/lib/analysis/client";
import { beginRun, endRun, isActive } from "@/lib/analysis-run";
import { crossOriginRejection } from "@/lib/origin";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const rejection = crossOriginRejection(request);
  if (rejection) return rejection;

  const { id } = await context.params;
  const repo = getRepository();

  const dream = repo.get(id);
  if (!dream) {
    return errorResponse(404, "not_found", "Dream not found.");
  }

  const config = loadConfig();
  if (!isConfigured(config)) {
    return errorResponse(
      503,
      "not_configured",
      "OPENAI_API_KEY is not set. Add it to .env.local (see .env.example) to enable AI analysis.",
    );
  }

  if (!repo.startAnalysis(id)) {
    if (isActive(id)) {
      return errorResponse(409, "analysis_running", "An analysis is already running for this dream.");
    }
    // Stale row: the status says running but this process holds no live
    // invocation for it (the previous handler died). Take it over.
    repo.failAnalysis(id, "Analysis was interrupted — please retry.");
    if (!repo.startAnalysis(id)) {
      return errorResponse(409, "analysis_running", "An analysis is already running for this dream.");
    }
  }
  // No await between the successful startAnalysis and beginRun: two
  // concurrent POSTs cannot both pass the check above.
  const owned = beginRun(id);

  try {
    const analysis = await analyzeDream(
      {
        content: dream.content,
        dreamDate: dream.dreamDate,
        title: dream.title,
        mood: dream.mood,
      },
      config,
    );
    repo.completeAnalysis(id, analysis, config.model);
    return Response.json({ dream: repo.get(id) });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Analysis failed for an unknown reason.";
    repo.failAnalysis(id, message);
    if (err instanceof AiError && err.code === "not_configured") {
      return errorResponse(503, "not_configured", err.message);
    }
    if (err instanceof AiError && err.code === "invalid_output") {
      return errorResponse(502, "invalid_output", err.message);
    }
    return errorResponse(502, "upstream_error", message);
  } finally {
    if (owned) endRun(id);
  }
}
