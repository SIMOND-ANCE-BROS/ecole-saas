/** Nom affiché d'une personne : raison sociale d'un professionnel, sinon prénom et nom. */
export function nomAffiche(p: { nom: string; prenom: string | null; raisonSociale: string | null }): string {
  return p.raisonSociale ?? [p.prenom, p.nom].filter(Boolean).join(" ");
}
