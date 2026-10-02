"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteDreamButton({ dreamId }: { dreamId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (!window.confirm("Delete this dream permanently?")) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/dreams/${dreamId}`, { method: "DELETE" });
      if (res.status === 404) {
        setError("This dream no longer exists.");
        return;
      }
      if (!res.ok) {
        setError("Could not delete this dream. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
        {deleting ? "Deleting…" : "Delete dream"}
      </button>
      {error && <span className="field-error">{error}</span>}
    </>
  );
}
