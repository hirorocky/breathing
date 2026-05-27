import type { Metadata } from "next";
import { IBM_Plex_Mono, Shippori_Mincho } from "next/font/google";
import { APP_TITLE } from "@/lib/constants";
import "./globals.css";

const serif = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "何もしなくていい。ただ、息が戻るまで、居ていい場所。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
