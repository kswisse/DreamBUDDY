import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <p style={{ marginTop: 0 }}>Dream not found.</p>
      <p className="small">It may have been deleted.</p>
      <Link href="/" className="button">
        Back to journal
      </Link>
    </div>
  );
}
