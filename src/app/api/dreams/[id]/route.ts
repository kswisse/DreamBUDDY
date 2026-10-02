import { getRepository } from "@/lib/repository";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const dream = getRepository().get(id);
  if (!dream) {
    return errorResponse(404, "not_found", "Dream not found.");
  }
  return Response.json({ dream });
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const removed = getRepository().remove(id);
  if (!removed) {
    return errorResponse(404, "not_found", "Dream not found.");
  }
  return new Response(null, { status: 204 });
}
