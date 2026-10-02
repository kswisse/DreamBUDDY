"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface FieldErrors {
  content?: string;
  dreamDate?: string;
}

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function NewDreamForm() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState("");
  const [dreamDate, setDreamDate] = useState(today());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/dreams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, title, mood, dreamDate }),
      });
      const body = (await res.json().catch(() => null)) as
        | { dream?: { id: string }; error?: { code: string; message: string } }
        | null;

      if (!res.ok) {
        if (body?.error?.code === "validation_error") {
          const message = body.error.message;
          if (/content/i.test(message)) setErrors({ content: message });
          else if (/dreamDate|date/i.test(message)) setErrors({ dreamDate: message });
          else setFormError(message);
        } else {
          setFormError(body?.error?.message ?? "Saving failed. Please try again.");
        }
        return;
      }

      if (body?.dream?.id) {
        router.push(`/dreams/${body.dream.id}?analyze=1`);
        return;
      }
      setFormError("Unexpected response from the server.");
    } catch {
      setFormError("Could not reach the server. Is it still running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" noValidate>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>Record a dream</h1>

      <label htmlFor="dreamDate">Dream date</label>
      <input
        id="dreamDate"
        type="date"
        value={dreamDate}
        onChange={(e) => setDreamDate(e.target.value)}
        required
      />
      {errors.dreamDate && <div className="field-error">{errors.dreamDate}</div>}

      <label htmlFor="title">Title (optional)</label>
      <input
        id="title"
        type="text"
        value={title}
        maxLength={200}
        placeholder="e.g. The glass forest"
        onChange={(e) => setTitle(e.target.value)}
      />

      <label htmlFor="mood">Mood on waking (optional)</label>
      <input
        id="mood"
        type="text"
        value={mood}
        maxLength={64}
        placeholder="e.g. calm, unsettled"
        onChange={(e) => setMood(e.target.value)}
      />

      <label htmlFor="content">What did you dream?</label>
      <textarea
        id="content"
        value={content}
        maxLength={20000}
        placeholder="Write everything you remember — people, places, feelings…"
        onChange={(e) => setContent(e.target.value)}
        required
      />
      {errors.content && <div className="field-error">{errors.content}</div>}

      {formError && <div className="alert alert-error">{formError}</div>}

      <div className="button-row">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save dream"}
        </button>
        <Link href="/" className="muted small">
          Cancel
        </Link>
      </div>
    </form>
  );
}
