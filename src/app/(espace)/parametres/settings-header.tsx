import Link from "next/link";

/** Fil d'Ariane et titre d'une rubrique des paramètres. */
export function SettingsHeader({ title: title, help: help }: { title: string; help: string }) {
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/parametres" className="lien">
          Paramètres
        </Link>
        <span className="text-doux"> / {title}</span>
      </nav>
      <div>
        <h1 className="titre-page">{title}</h1>
        <p className="text-sm text-doux">{help}</p>
      </div>
    </>
  );
}
