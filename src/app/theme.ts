import {
  createTheme,
  defaultVariantColorsResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from "@mantine/core";

/**
 * Mantine theme (#107), aligned with the `globals.css` tokens: the interface
 * indigo as primary colour, slate grey, Geist font, 8 px corner radius.
 * Model: the FFD-Connect back office (apps/admin/src/theme.ts).
 */

// Interface indigo (#4f46e5 in light mode, brighter in dark mode).
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

// Slate grey for the interface's light greys.
const slate: MantineColorsTuple = [
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

// Mantine dark scale: from light text (0) to the darkest surface (9), close to --fond / --surface.
const dark: MantineColorsTuple = [
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

/**
 * Text of filled buttons and badges: Mantine always writes it white, but the
 * dark-mode shades (4) are light, white on them reads at 3:1 (#185). It
 * follows the colour scheme through `--filled-text` (cssVariablesResolver).
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  return input.variant === "filled" ? { ...colors, color: "var(--filled-text)" } : colors;
};

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 6, dark: 4 },
  colors: { accent, gray: slate, dark: dark },
  fontFamily: "var(--font-geist-sans), system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, monospace",
  headings: { fontWeight: "600" },
  variantColorResolver,
  defaultRadius: "md",
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" },
  // Front-desk density: compact fields and tables.
  components: {
    Table: { defaultProps: { verticalSpacing: "xs", highlightOnHover: true } },
    // Sentence case like the rest of the copy (DESIGN.md), not Mantine's capitals.
    Badge: { defaultProps: { tt: "none" } },
  },
});

/**
 * Dark mode: Mantine takes the text colour of `light` and `subtle` variants from
 * shade `primaryShade.dark - 5`, i.e. shade 0 with our bright dark shade (4): red
 * « Désactiver » or « Révoquer » turned almost white (#180). Shade 3 keeps the hue
 * readable on the dark background, as with Mantine's default shade.
 */
export const cssVariablesResolver: CSSVariablesResolver = (t) => ({
  variables: {},
  light: { "--filled-text": "var(--mantine-color-white)" },
  dark: {
    ...Object.fromEntries(
      Object.keys(t.colors)
        .filter((c) => c !== "dark")
        .map((c) => [`--mantine-color-${c}-light-color`, `var(--mantine-color-${c}-3)`]),
    ),
    // Near-black on the light dark-mode fills, as the old `--sur-accent` (#11131a).
    "--filled-text": "var(--mantine-color-dark-8)",
  },
});
