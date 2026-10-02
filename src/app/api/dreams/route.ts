import { getRepository } from "@/lib/repository";
import { ValidationError } from "@/lib/dreams";
import { crossOriginRejection } from "@/lib/origin";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(request: Request): Promise<Response> {
  const limitParam = new URL(request.url).searchParams.get("limit");
  let limit: number | undefined;
  if (limitParam !== null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return errorResponse(400, "validation_error", "limit must be an integer between 1 and 100.");
    }
  }
  try {
    const dreams = getRepository().list(limit ? { limit } : undefined);
    return Response.json({ dreams });
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(400, "validation_error", err.message);
    }
    throw err;
  }
}

export async function POST(request: Request): Promise<Response> {
  const rejection = crossOriginRejection(request);
  if (rejection) return rejection;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "validation_error", "Request body must be valid JSON.");
  }

  const input = body as Record<string, unknown>;
  try {
    const dream = getRepository().create({
      content: typeof input.content === "string" ? input.content : "",
      dreamDate:
        typeof input.dreamDate === "string" ? input.dreamDate : undefined,
      title: typeof input.title === "string" ? input.title : undefined,
      mood: typeof input.mood === "string" ? input.mood : undefined,
    });
    return Response.json({ dream }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(400, "validation_error", err.message);
    }
    throw err;
  }
}
