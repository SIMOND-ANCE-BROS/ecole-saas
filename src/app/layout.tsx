// globals.css d'abord : sa première ligne fixe l'ordre des couches (theme, base, mantine…) ;
// importé après Mantine, la couche mantine passerait sous la remise à zéro de Tailwind.
import "./globals.css";
import "@mantine/core/styles.layer.css";
import "@mantine/dates/styles.layer.css";
import "@mantine/notifications/styles.layer.css";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Gestion d’école de danse", template: "%s · Gestion d’école de danse" },
  description: "Danseurs et payeurs, inscriptions, planning, facturation et paie des professeurs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} {...mantineHtmlProps}>
      <head>
        {/* Mode sombre de Mantine posé avant l'affichage, comme le système (pas d'éclair blanc). */}
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
