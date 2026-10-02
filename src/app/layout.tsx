import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Adverse Media Agent",
  description: "Adverse-media screening of individuals",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav">
          <Link href="/">Screen</Link>
          <Link href="/history">History</Link>
          <Link href="/watchlist">Watchlist</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
