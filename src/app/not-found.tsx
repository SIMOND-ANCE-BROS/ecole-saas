import Link from "next/link";

/** An address that matches no page (outside the workspace frame). */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-16">
      <h1 className="titre-page">Page introuvable</h1>
      <p className="text-sm text-doux">Cette adresse ne correspond à aucune page.</p>
      <Link href="/" className="bouton-principal">
        Retour à l’accueil
      </Link>
    </main>
  );
}
