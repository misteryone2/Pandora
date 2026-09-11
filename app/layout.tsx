import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pandora",
  description: "Personal autonomous assistant",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pandora", statusBarStyle: "black-translucent" }
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="it"><body>{children}</body></html>;
}
