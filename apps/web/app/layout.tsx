import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

// next/font self-hosts at build time — no runtime request to Google's
// CDN, so this can't be flaky the way an external <link> fetch would be.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AlphaRadar",
  description: "Web3 opportunity-intelligence platform",
};

// Inline, synchronous, runs before first paint — the standard no-flash
// theme pattern. Dark is canonical (the server-rendered default below);
// this only overrides to "light" when a stored preference or
// prefers-color-scheme says so, so a light-preferring visitor never
// sees a flash of the dark theme first. suppressHydrationWarning on
// <html> is required because this script can change the class attribute
// client-side before React hydrates.
const THEME_INIT_SCRIPT = `
  try {
    var stored = localStorage.getItem('ar-theme');
    var theme = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
  } catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground font-display min-h-screen antialiased">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
