import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DreamBUDDY",
  description:
    "Record, analyze, and interpret your dreams to promote mental wellness and creativity.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="site-header">
            <div>
              <Link href="/" className="brand">
                Dream<span>BUDDY</span>
              </Link>
              <div className="tagline">
                Record, analyze, and reflect on your dreams.
              </div>
            </div>
            <Link href="/new" className="button">
              + New dream
            </Link>
          </header>
          <main>{children}</main>
          <p className="footer-note">
            DreamBUDDY offers reflective prompts, not medical advice.
          </p>
        </div>
      </body>
    </html>
  );
}
