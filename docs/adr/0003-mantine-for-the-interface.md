# 0003. Use Mantine for every interface control, Tailwind for layout only

- Status: Accepted
- Date: 2026-10-22
- Issues: #107, #115

## Context
Screens were built with hand-made Tailwind classes (`.champ`,
`.bouton-principal`, native popovers…). Rich controls (date pickers, menus,
notifications, accessible selects) were costly to build and inconsistent. The
project owner found the interface less intuitive than FFD-Connect's back
office, built with Mantine. Mantine 8.3.18 was installed in #107 (Mantine 9
was too recent for the 14-day rule).

## Decision
- Every control (inputs, selects, buttons, menus, popovers, tables, modals,
  drawers, notifications, dates) is a Mantine component, themed in
  `src/app/theme.ts`.
- Tailwind remains for layout (flex, grid, spacing, responsive visibility).
- `globals.css` is imported **before** Mantine styles: its first line declares
  the layer order (`theme, base, mantine, components, utilities`); otherwise
  Tailwind's reset wipes Mantine styles.
- Existing screens migrate one by one (#115); custom control classes are
  removed once unused.
- FFD-Connect is a source of technical ideas, never of screens: this product
  targets non-technical users (front desk), its screens must stay simpler.

## Alternatives considered
- **shadcn/ui** (previously planned): components copied into the repo, more
  code to own and maintain; rejected.
- **Keep hand-made classes**: no rich controls, inconsistent behaviour; rejected.
- **Mixed (Mantine for rich controls only)**: two styles to maintain; rejected.

## Consequences
- Dependencies: `@mantine/core`, `@mantine/hooks`, `@mantine/dates`,
  `@mantine/notifications`, `dayjs`, pinned.
- Mantine components need client components; server pages pass data, not
  render functions.
- Dark mode follows the system (`defaultColorScheme="auto"`).
