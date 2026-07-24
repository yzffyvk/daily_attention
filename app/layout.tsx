import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
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

function metadataOrigin(requestHeaders: Headers) {
  const requestedHost = (
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? ""
  ).split(",")[0]?.trim();
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : requestedHost?.startsWith("localhost") || requestedHost?.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    return new URL(`${protocol}://${requestedHost}`);
  } catch {
    return new URL("http://localhost:3200");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const metadataBase = metadataOrigin(requestHeaders);
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
