import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function metadataOrigin() {
  const configuredOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
  try {
    const origin = new URL(configuredOrigin);
    if (origin.origin !== configuredOrigin.replace(/\/+$/u, "")) throw new Error("APP_ORIGIN must not include a path");
    if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") {
      throw new Error("APP_ORIGIN must use HTTPS outside local development");
    }
    return origin;
  } catch {
    throw new Error("APP_ORIGIN must be an absolute trusted origin");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = metadataOrigin();
  const ogImage = new URL("/og.png", metadataBase).toString();
  const description = "Attention is all you need~";

  return {
    metadataBase,
    title: "今天你attention了吗？",
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "今天你attention了吗？",
      description,
      images: [{ url: ogImage, width: 1731, height: 909 }],
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: "今天你attention了吗？",
      description,
      images: [ogImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
