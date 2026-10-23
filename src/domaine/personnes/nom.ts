/** Nom affiché d'une personne : raison sociale d'un professionnel, sinon prénom et nom. */
export function displayedName(p: { name: string; firstName: string | null; companyName: string | null }): string {
  return p.companyName ?? [p.firstName, p.name].filter(Boolean).join(" ");
}
