/**
 * « de » before a name, elided before a vowel or an h: « d’Émilie »,
 * « d’Hugo », « de Jules ». For user-facing text (« Coordonnées d’Émilie »).
 */
export function ofName(name: string): string {
  return /^[aeiouhàâäéèêëîïôöùûüæœ]/i.test(name.trim()) ? `d’${name.trim()}` : `de ${name.trim()}`;
}
