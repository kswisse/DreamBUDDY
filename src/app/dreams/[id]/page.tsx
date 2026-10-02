import { notFound } from "next/navigation";
import Link from "next/link";
import { getRepository } from "@/lib/repository";
import AnalysisPanel from "@/components/AnalysisPanel";
import DeleteDreamButton from "@/components/DeleteDreamButton";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ analyze?: string }>;
}

export default async function DreamDetailPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { analyze } = await searchParams;
  const dream = getRepository().get(id);
  if (!dream) notFound();

  return (
    <section>
      <Link href="/" className="back-link">
        ← Back to journal
      </Link>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="dream-meta" style={{ marginBottom: 8 }}>
          <span>{dream.dreamDate}</span>
          {dream.mood && <span>· felt {dream.mood}</span>}
          <span>· recorded {dream.createdAt.slice(0, 10)}</span>
        </div>
        <h1 style={{ margin: "0 0 12px", fontSize: 22 }}>
          {dream.title || "Untitled dream"}
        </h1>
        <div className="prose">{dream.content}</div>
        <div className="button-row">
          <DeleteDreamButton dreamId={dream.id} />
        </div>
      </article>

      <AnalysisPanel
        dreamId={dream.id}
        initialStatus={dream.analysisStatus}
        initialAnalysis={dream.analysis}
        initialError={dream.analysisError}
        initialModel={dream.model}
        initialAnalyzedAt={dream.analyzedAt}
        autoStart={analyze === "1" && dream.analysisStatus !== "running"}
      />
    </section>
  );
}
