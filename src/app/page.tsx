import Link from "next/link";
import { getRepository } from "@/lib/repository";
import { STATUS_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

export default function JournalPage() {
  const repo = getRepository();
  const dreams = repo.list();
  const total = repo.count();

  return (
    <section>
      <div className="button-row" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Your dream journal</h1>
        <span className="muted small">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </div>

      {dreams.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>No dreams yet.</p>
          <p className="small">
            Memories fade fast after waking — write yours down while it is fresh.
          </p>
          <Link href="/new" className="button">
            Record your first dream
          </Link>
        </div>
      ) : (
        <>
          {dreams.length < total && (
            <p className="muted small" style={{ marginBottom: 8 }}>
              Showing the {dreams.length} most recent of {total} entries.
            </p>
          )}
          {dreams.map((dream) => (
            <article key={dream.id} className="card dream-card">
              <Link href={`/dreams/${dream.id}`} className="dream-link">
                <h2 className="dream-title">
                  {dream.title || dream.content.slice(0, 60) || "Untitled dream"}
                </h2>
                <div className="dream-meta">
                  <span>{dream.dreamDate}</span>
                  {dream.mood && <span>· {dream.mood}</span>}
                  <span className={`badge badge-${dream.analysisStatus}`}>
                    {STATUS_LABEL[dream.analysisStatus]}
                  </span>
                </div>
                <p className="excerpt">{dream.content}</p>
              </Link>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
