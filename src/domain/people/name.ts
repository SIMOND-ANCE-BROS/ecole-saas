/** A person's displayed name: company name for a business, otherwise first and last name. */
export function displayedName(p: { name: string; firstName: string | null; companyName: string | null }): string {
  return p.companyName ?? [p.firstName, p.name].filter(Boolean).join(" ");
}
