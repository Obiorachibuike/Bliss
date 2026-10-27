import type { Metadata, Viewport } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Toaster } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: {
    default: "Bliss — Your ideas. Infinite possibilities.",
    template: "%s · Bliss",
  },
  description:
    "Bliss is an all-in-one AI workspace: chat with Llama, GPT-5 Nano, Gemini and DeepSeek, generate and edit images, and turn any picture into a video.",
  applicationName: "Bliss",
  openGraph: {
    title: "Bliss — AI Workspace",
    description:
      "Chat, create images and generate video with one blue-glass AI workspace.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7FAFF" },
    { media: "(prefers-color-scheme: dark)", color: "#080D18" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

// Applies the persisted theme before paint to avoid a flash of the wrong palette.
const themeInit = `(function(){try{var r=JSON.parse(localStorage.getItem('bliss-settings-storage')||'{}');var t=(r&&r.state&&r.state.theme)||'dark';if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;d.classList.toggle('dark',t==='dark');d.classList.toggle('light',t==='light');d.setAttribute('data-theme',t);}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="flex h-full flex-col antialiased">
        <ThemeProvider>
          <div className="flex min-h-0 flex-1">{children}</div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
