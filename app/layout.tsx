import type { Metadata } from "next";
import Providers from "./providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConverserXAI — Avatar Assistant",
  description: "Conversational AI with lip-synced avatar responses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <head>
        <link rel="dns-prefetch" href="//api.groq.com" />
        <link rel="dns-prefetch" href="//api.d-id.com" />
        <link rel="dns-prefetch" href="//api.openai.com" />
        <link rel="preconnect" href="https://api.groq.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.d-id.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.openai.com" crossOrigin="" />
        <link
          rel="preload"
          as="image"
          href="https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.png"
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ErrorBoundary>
          <Providers>
            {children}
            <Toaster position="top-right" richColors closeButton />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
