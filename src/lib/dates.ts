/**
 * A date typed at the front desk, read strictly (#115): « 12/09/2027 »,
 * « 1/9/2027 », « 1/9/27 » (20xx), « 12092027 », with « . » or « - » as
 * separator too, or an ISO date pasted as is. Returns `YYYY-MM-DD`, or null
 * while the date is incomplete or does not exist (31/02): a half-typed
 * « 12/09/2 » is never taken for year 2.
 */
export function parseTypedDate(input: string): string | null {
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  const year = (y: string) => Number(y.length === 2 ? `20${y}` : y);
  const [y, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : fr
      ? [year(fr[3]), Number(fr[2]), Number(fr[1])]
      : [0, 0, 0];
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  // Day 0 of the next month is the last day of this one (UTC: no time-zone shift).
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const shown = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

/**
 * Why a typed date is refused, as a message for the field, or null when it
 * is empty or acceptable: unreadable, or outside the optional `min`/`max`
 * bounds (`YYYY-MM-DD`, inclusive).
 */
export function typedDateRefusal(input: string, min: string | null, max: string | null): string | null {
  if (input.trim() === "") return null;
  const date = parseTypedDate(input);
  if (date === null) return "Date non reconnue : tapez jj/mm/aaaa";
  if (min && max && (date < min || date > max)) return `Choisissez une date du ${shown(min)} au ${shown(max)}`;
  if (min && date < min) return `Choisissez une date à partir du ${shown(min)}`;
  if (max && date > max) return `Choisissez une date jusqu’au ${shown(max)}`;
  return null;
}
