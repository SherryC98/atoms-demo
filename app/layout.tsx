import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BUILD_INFO } from "@/lib/build-info";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atoms · 一句话生成小应用",
  description: "用一句话描述需求，AI 几十秒生成一个可运行的单页小应用。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* 构建信息：供评审核对线上版本与 GitHub 提交是否对应 */}
        <meta name="x-build-sha" content={BUILD_INFO.sha} />
        <meta name="x-build-ref" content={BUILD_INFO.ref} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ATOMS_BUILD__=${JSON.stringify(BUILD_INFO)};`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
