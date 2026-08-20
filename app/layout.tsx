import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import "./globals.css";
import { AgentationProvider } from "@/components/AgentationProvider";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PageSpeed Auditor",
  description: "Internal PageSpeed Insights auditing for the whole site.",
};

// Sets data-theme before the rest of <body> paints, so an explicit light/dark
// choice (see ThemeToggle.tsx) applies instantly on load instead of flashing
// the OS-default theme first. Plain inline script, not an effect: an effect
// runs after paint, which is exactly the flash this exists to avoid.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${dmSans.variable}`}
      // The inline script below sets data-theme before hydration, which is a
      // deliberate mismatch against the server-rendered markup (the server
      // has no idea what was in localStorage) -- the documented escape hatch
      // for exactly this case, not a sign something is actually wrong.
      suppressHydrationWarning
    >
      <body className="font-[family-name:var(--font-body)] antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
        <AgentationProvider />
      </body>
    </html>
  );
}
