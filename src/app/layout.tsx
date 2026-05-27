import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trepa Prediction Arena",
  description: "High-performance prediction market dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased overflow-x-hidden selection:bg-purple-500 selection:text-white" suppressHydrationWarning>
        <div className="fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />
        <main className="relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}
