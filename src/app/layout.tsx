import type { Metadata, Viewport } from "next";
import { Prompt, Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider, Toaster } from "@/components/ui/toast";

const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0c1a3d",
};

export const metadata: Metadata = {
  title: "KIDKUBPOS",
  description: "Multi-tenant POS Ecosystem for modern retail businesses",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KIDKUBPOS",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${prompt.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="h-full">
        <ToastProvider>
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
