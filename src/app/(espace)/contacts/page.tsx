import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { listerContacts } from "@/db/eleves";
import { nomAffiche } from "@/db/personnes";
import { exigerRole } from "@/lib/session";
import { ResultatsNavigables } from "../_personnes/resultats";

export const metadata: Metadata = { title: "Contacts" };

/** Parents, payeurs et organismes (CSE, entreprises). */
export default async function PageContacts({ searchParams }: PageProps<"/contacts">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { q } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const contacts = await avecEcole(ecoleId, (tx) => listerContacts(tx, saisie));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Contacts</h1>
          <p className="text-sm text-doux">Parents, responsables, payeurs et organismes (CSE, entreprises).</p>
        </div>
        <Link href="/contacts/nouveau" className="bouton-principal">
          Nouveau contact
        </Link>
      </div>
      <form className="flex max-w-md gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Rechercher un contact
        </label>
        <input id="q" name="q" type="search" className="champ w-full" placeholder="Nom, téléphone, e-mail…" defaultValue={saisie} />
        <button type="submit" className="bouton-secondaire">
          Rechercher
        </button>
      </form>
      {contacts.length === 0 ? (
        <p className="text-sm">{saisie ? "Aucun contact ne correspond." : "Aucun contact pour l’instant."}</p>
      ) : (
        <ResultatsNavigables>
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <caption className="sr-only">Contacts</caption>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Pour les élèves</th>
                  <th>Téléphone</th>
                  <th className="hidden sm:table-cell">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/contacts/${c.id}`} data-resultat className="lien font-medium">
                        {nomAffiche(c)}
                      </Link>
                      {c.type === "professionnel" && <span className="ml-2 text-xs text-doux">organisme</span>}
                    </td>
                    <td>{c.eleves.join(", ") || <span className="text-doux">—</span>}</td>
                    <td className="whitespace-nowrap tabular-nums">{c.telephone ?? "—"}</td>
                    <td className="hidden break-all sm:table-cell">{c.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ResultatsNavigables>
      )}
    </section>
  );
}
