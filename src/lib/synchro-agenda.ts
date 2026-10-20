import { AccesRetire, identifiants, lirePlagesOccupees, rafraichir } from "../connecteurs/agenda/oauth";
import { avecEcole } from "../db";
import { intervenantsConnectes, lireConnexion, noterSynchro } from "../db/connexions-agenda";
import { remplacerIndisponibilitesAgenda } from "../db/disponibilites";
import { chiffrer, dechiffrer } from "./chiffrement";

/** Fenêtre lue dans les agendas : de la veille à quatre mois. */
const AVANT = 1;
const APRES = 120;
const JOUR = 86_400_000;

/**
 * Lit les plages occupées de l'agenda connecté d'un intervenant et remplace
 * ses indisponibilités venues de cet agenda. Les appels réseau ont lieu hors
 * transaction ; aucune donnée personnelle dans les messages d'erreur.
 */
export async function synchroniserAgenda(
  ecoleId: string,
  intervenantId: string,
  requete: typeof fetch = fetch,
  maintenant = new Date(),
): Promise<{ ok: true; plages: number } | { ok: false; message: string }> {
  const connexion = await avecEcole(ecoleId, (tx) => lireConnexion(tx, intervenantId));
  if (!connexion) return { ok: false, message: "Aucun agenda connecté." };
  const echec = async (message: string) => {
    await avecEcole(ecoleId, (tx) => noterSynchro(tx, intervenantId, { erreur: message }));
    return { ok: false as const, message };
  };
  const id = identifiants(connexion.fournisseur);
  if (!id) return echec("Connexion à ce fournisseur non configurée sur le serveur.");

  try {
    const { acces, nouveauRafraichissement } = await rafraichir(connexion.fournisseur, id, dechiffrer(connexion.jetonChiffre), requete);
    const fenetre = { debut: new Date(maintenant.getTime() - AVANT * JOUR), fin: new Date(maintenant.getTime() + APRES * JOUR) };
    const plages = await lirePlagesOccupees(connexion.fournisseur, acces, fenetre, requete);
    const nombre = await avecEcole(ecoleId, async (tx) => {
      const n = await remplacerIndisponibilitesAgenda(tx, intervenantId, connexion.fournisseur, fenetre, plages);
      await noterSynchro(tx, intervenantId, { erreur: null, jetonChiffre: nouveauRafraichissement ? chiffrer(nouveauRafraichissement) : undefined });
      return n;
    });
    return { ok: true, plages: nombre };
  } catch (e) {
    return echec(e instanceof AccesRetire ? e.message : "Synchronisation impossible pour le moment ; elle sera retentée.");
  }
}

/** Tous les agendas connectés d'une école (tâche de fond). */
export async function synchroniserEcole(ecoleId: string, requete: typeof fetch = fetch): Promise<{ reussies: number; echouees: number }> {
  const ids = await avecEcole(ecoleId, (tx) => intervenantsConnectes(tx));
  let reussies = 0;
  for (const intervenantId of ids) if ((await synchroniserAgenda(ecoleId, intervenantId, requete)).ok) reussies++;
  return { reussies, echouees: ids.length - reussies };
}
