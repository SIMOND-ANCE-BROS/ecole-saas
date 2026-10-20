import Link from "next/link";

/** Fil d'Ariane et titre d'une rubrique des paramètres. */
export function EnteteParametres({ titre, aide }: { titre: string; aide: string }) {
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/parametres" className="lien">
          Paramètres
        </Link>
        <span className="text-doux"> / {titre}</span>
      </nav>
      <div>
        <h1 className="titre-page">{titre}</h1>
        <p className="text-sm text-doux">{aide}</p>
      </div>
    </>
  );
}
