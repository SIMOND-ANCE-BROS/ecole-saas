import Link from "next/link";

/** A record that no longer exists (or never did) in the school: e.g. a deleted student. */
export default function NotFound() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="titre-page">Page introuvable</h1>
      <p className="text-sm text-doux">Cette fiche n’existe pas ou a été supprimée.</p>
      <Link href="/" className="bouton-principal">
        Retour à l’accueil
      </Link>
    </section>
  );
}
