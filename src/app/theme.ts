import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Thème Mantine (#107), aligné sur les jetons de `globals.css` : indigo de
 * l'interface en couleur principale, gris ardoise, police Geist, arrondis
 * de 8 px. Modèle : le back-office de FFD-Connect (apps/admin/src/theme.ts).
 */

// Indigo de l'interface (#4f46e5 en clair, plus lumineux en sombre).
const accent: MantineColorsTuple = [
  "#eef2ff",
  "#e0e7ff",
  "#c7d2fe",
  "#a5b4fc",
  "#818cf8",
  "#6366f1",
  "#4f46e5",
  "#4338ca",
  "#3730a3",
  "#312e81",
];

// Gris ardoise pour les gris clairs de l'interface.
const ardoise: MantineColorsTuple = [
  "#f8fafc",
  "#f1f5f9",
  "#e2e8f0",
  "#cbd5e1",
  "#94a3b8",
  "#64748b",
  "#475569",
  "#334155",
  "#1e293b",
  "#0f172a",
];

// Échelle sombre de Mantine : du texte clair (0) à la surface la plus sombre (9), proche de --fond / --surface.
const sombre: MantineColorsTuple = [
  "#e6e8ef",
  "#c7ccd8",
  "#9ba2b4",
  "#6b7387",
  "#3a4052",
  "#2b3040",
  "#191c25",
  "#151821",
  "#11131a",
  "#0b0d12",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 6, dark: 4 },
  colors: { accent, gray: ardoise, dark: sombre },
  fontFamily: "var(--font-geist-sans), system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, monospace",
  headings: { fontWeight: "600" },
  defaultRadius: "md",
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" },
  // Densité de l'accueil : des champs et tableaux compacts.
  components: {
    Table: { defaultProps: { verticalSpacing: "xs", highlightOnHover: true } },
  },
});
