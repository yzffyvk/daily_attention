import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./attention-theme.css";
import "./knowledge-theme.css";
import "./knowledge-structure.css";
import "./light-theme.css";
import { themeBootstrapScript } from "@/features/theme/theme-bootstrap";
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
  const description = "让每一次学习，连成自己的知识地图。以点成线，以线成面。在记录中积累，在关联中理解。";

  return {
    metadataBase,
    title: "知序 Aura｜让每一次学习，连成自己的知识地图。",
    description,
    icons: {
      icon: "/aura-icon.svg",
      shortcut: "/aura-icon.svg",
    },
    openGraph: {
      title: "知序 Aura｜让每一次学习，连成自己的知识地图。",
      description,
      images: [{ url: ogImage, width: 1731, height: 909 }],
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: "知序 Aura｜让每一次学习，连成自己的知识地图。",
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
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
