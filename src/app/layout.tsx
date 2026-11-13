import type { Metadata } from "next";
import { Figtree, Fragment_Mono } from "next/font/google";
import "./globals.css";
import { ClinicProvider } from "../components/ClinicProvider";
import { Shell } from "../components/Shell";

const figtree = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-ui", display: "swap" });
const mono = Fragment_Mono({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Klinika Dental Lumi: bookings",
  description: "A role-based clinic bookings dashboard demo by EmSoft. Fictional clinic, sandbox data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${mono.variable}`}>
      <body>
        <ClinicProvider>
          <Shell>{children}</Shell>
        </ClinicProvider>
      </body>
    </html>
  );
}
