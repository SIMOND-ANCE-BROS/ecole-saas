import type { Metadata } from "next";
import Link from "next/link";
import { exigerRole } from "@/lib/session";
import { FormulaireFamille } from "../formulaire";

export const metadata: Metadata = { title: "Nouvelle famille" };

export default async function PageNouvelleFamille() {
  await exigerRole("direction", "accueil");
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/familles" className="lien">
          Familles
        </Link>
        <span className="text-doux"> / Nouvelle</span>
      </nav>
      <h1 className="titre-page">Nouvelle famille</h1>
      <FormulaireFamille famille={null} />
    </section>
  );
}
