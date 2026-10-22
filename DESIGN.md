# DESIGN.md — interface rules

The product is the front desk's everyday tool at a dance school: during
enrollment desk hours, someone types fast on a Windows PC while a parent waits.
The interface must be **obvious** (no training, no jargon) and **fast**
(keyboard, few clicks, dense lists). It is not a back office for technicians:
FFD-Connect is a source of technical ideas, never of screens.

Source of truth for tokens: `src/app/theme.ts` (Mantine theme) and the colour
variables at the top of `src/app/globals.css`. Decision: ADR 0003.

## Voice

- Everything the user sees is in **French**, with the typographic apostrophe (’)
  and « » quotes.
- Plain words of the school, never internal ones: « élève », « contact »,
  « Facturé à », « à prévenir », never « lien », « entité », « payload ».
- Direct and active: « Encaisser le paiement », not « Le paiement sera encaissé ».
  A button names exactly what it does, and the confirmation uses the same verb.
- Numbers plainly: « 12 élèves », « 45,00 € ».
- An empty screen says what to do next (« Aucun élève ne correspond. Effacer
  les filtres »). An error says what happened and how to fix it, without
  apologising and without technical detail.

## Components

- **Mantine for every control**: `TextInput`, `Select`, `Checkbox`, `Button`,
  `Menu`, `Popover`, `Table`, `Modal`, `Drawer`, `DatePickerInput`,
  notifications. No hand-made control class (`.champ`, `.bouton-principal`…
  are being removed, #115).
- **Tailwind for layout only**: flex, grid, gaps, responsive visibility.
- One primary button per view (the main action); secondary actions are
  `variant="default"` or `subtle`; destructive actions use `color="red"` and
  ask for confirmation.
- **Lists** behave like Excel autofilters: each column header opens a menu to
  sort and filter (checkboxes, from/to, « contient »); the sort arrow and a
  funnel show on the header; active filters are removable chips; the whole row
  opens the record; one search bar at the top (Ctrl K). No AND/OR builder.
- **Forms and records**: a real page, also opened as a side panel (`Drawer`)
  over the current list, so the user keeps their place. Short confirmations
  are modals.
- Feedback after an action: a notification bottom right, with the same verb as
  the button (« Paiement encaissé »).

## Colour

- Accent: indigo (`accent` in the theme), for interaction only. Neutrals: slate.
- Semantic colours: green for success, amber for warnings, red for errors and
  destructive actions only.
- At most one accent colour in a view, plus semantic colours when needed.
- Dark mode follows the system and must stay readable (contrast WCAG AA).

## Typography and density

- Geist, three weights (400, 500, 600). One H1 per page; never skip a level.
- Body 14 px on desktop, 16 px on phones; never below 12 px.
- Numbers in tables use tabular figures and are right-aligned.
- Dense tables (`verticalSpacing="xs"`): the front desk scans many rows.

## Spacing and shape

- Spacing from the Mantine scale (`xs` 4 → `xl` 32) or Tailwind steps of 4 px;
  no arbitrary values.
- Radius `md` (8 px) by default; pills only for chips and badges.
- Borders define surfaces; shadows only for floating layers (menus, modals).

## Keyboard and accessibility

- Every field has a visible label; every icon button has an `aria-label`.
- Every action works with the keyboard; focus is always visible.
- Ctrl K focuses the search; arrow down moves into the results; Enter opens.
- Click targets at least 32 px on desktop and 44 px on phones.
- Never convey information by colour alone (add a word or an icon).

## Motion

- Only for feedback (opening, closing, confirming): 150–250 ms, never above
  500 ms, only `transform` and `opacity`. Respect `prefers-reduced-motion`.

## Responsive

- Desktop first (front-desk PC), but every screen works at phone width:
  tables become cards, column tools are hidden, no horizontal page scroll.

## What we never ship

- Jargon or English in the interface.
- Several primary buttons in the same view.
- Decorative cards, gradients, emoji in headings.
- Filters that require understanding operators or boolean logic.
- A form that loses the user's input after an error.
- A screen checked only in light mode on a wide desktop.

## When in doubt

Look at the students list and the person record: new screens should feel like
they belong next to them. To break a rule above, write the exception here
first, with the reason.
