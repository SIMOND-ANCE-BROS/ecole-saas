import { notFound, redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { estEleve } from "@/db/eleves";
import { exigerRole } from "@/lib/session";

/** Ancienne adresse d'une personne : renvoie vers sa fiche élève ou contact. */
export default async function AnciennePersonne({ params }: PageProps<"/personnes/[id]">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const eleve = await avecEcole(ecoleId, (tx) => estEleve(tx, id));
  if (eleve === null) notFound();
  redirect(eleve ? `/eleves/${id}` : `/contacts/${id}`);
}
