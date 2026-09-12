import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pandora",
  description: "Personal autonomous assistant",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pandora", statusBarStyle: "black-translucent" }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="it"><body>{children}</body></html>;
}
