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
