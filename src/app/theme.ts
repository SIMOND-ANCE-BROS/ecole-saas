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
 * The primary colour is the exception: its dark-mode fill is the deep indigo
 * (shade 6, see cssVariablesResolver), so its text stays white (#211).
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  if (input.variant !== "filled") return colors;
  const primary = !input.color || input.color === input.theme.primaryColor;
  return { ...colors, color: primary ? "var(--mantine-color-white)" : "var(--filled-text)" };
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
 * « Désactiver » or « Révoquer » turned almost white (#180). The `outline` variant
 * takes shade `- 4`, so « Oui, supprimer » turned white too (#187). Shade 3 keeps
 * the hue readable on the dark background, as with Mantine's default shade.
 *
 * Light mode: yellow 6 on white or on its pale tint reads at 2:1, a pressed
 * « Absent » or a « Complet » badge looked disabled (#187). A dark amber
 * (6:1 on white) keeps the hue. Red 6, used for red text and field errors,
 * reads at 3.2:1 on white (#188): a darker red (6.6:1) replaces it, also for
 * the `outline`, `light` and `subtle` red buttons (« Retirer … de la fiche »).
 *
 * Dark mode, primary colour: many Mantine parts write white on the primary
 * fill without going through the variant resolver (highlighted option of a
 * list, selected day of a calendar, checked boxes, segmented controls). On
 * shade 4 that reads at 3:1 (#211); on the deep indigo of light mode (shade 6)
 * white text and ticks read at 6.3:1 (shade 5 would fall below 4.5:1). The
 * fill itself stands out less from the dark page (2.9:1): its white content
 * carries the meaning. Focus rings and focused field borders keep the bright
 * `--accent` (globals.css).
 */
export const cssVariablesResolver: CSSVariablesResolver = (t) => ({
  variables: {},
  light: {
    "--filled-text": "var(--mantine-color-white)",
    "--mantine-color-yellow-light-color": "#8f5500",
    "--mantine-color-yellow-outline": "#8f5500",
    "--mantine-color-red-text": "#b42318",
    "--mantine-color-error": "#b42318",
    "--mantine-color-red-light-color": "#b42318",
    "--mantine-color-red-outline": "#b42318",
  },
  dark: {
    ...Object.fromEntries(
      Object.keys(t.colors)
        .filter((c) => c !== "dark")
        .flatMap((c) => [
          [`--mantine-color-${c}-light-color`, `var(--mantine-color-${c}-3)`],
          [`--mantine-color-${c}-outline`, `var(--mantine-color-${c}-3)`],
        ]),
    ),
    // Near-black on the light dark-mode fills, as the old `--sur-accent` (#11131a).
    "--filled-text": "var(--mantine-color-dark-8)",
    // Field errors take red 8 by default, 4.1:1 on the dark page (#188): the red of `c="red"` text instead.
    "--mantine-color-error": "var(--mantine-color-red-text)",
    // The primary fill takes the deep indigo, with white text (#211).
    [`--mantine-color-${t.primaryColor}-filled`]: `var(--mantine-color-${t.primaryColor}-6)`,
    [`--mantine-color-${t.primaryColor}-filled-hover`]: `var(--mantine-color-${t.primaryColor}-7)`,
  },
});
