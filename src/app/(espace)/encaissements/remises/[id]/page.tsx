import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireRemise } from "@/db/remises";
import { school } from "@/db/schema";
import { formaterEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";
import { AnnulerRemise, Imprimer } from "./boutons";

export const metadata: Metadata = { title: "Bordereau de remise" };

const jour = (iso: string) => iso.split("-").reverse().join("/");
const DE_QUOI = { cheque: "chèques", especes: "espèces", cheque_vacances: "chèques vacances" } as const;

/** Bordereau d'une remise en banque (#98), à imprimer et à joindre au dépôt. */
export default async function PageRemise({ params, searchParams }: PageProps<"/encaissements/remises/[id]">) {
  const { ecoleId, role } = await exigerRole("direction", "accueil");
  const [{ id }, { cree }] = await Promise.all([params, searchParams]);
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const r = await lireRemise(tx, id);
    const [e] = await tx.select({ nom: school.name }).from(school).where(eq(school.id, ecoleId));
    return r ? { r, ecole: e?.nom ?? "" } : null;
  });
  if (!donnees) notFound();
  const { r } = donnees;

  return (
    <article className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <Link href="/encaissements?vue=remises" className="lien">
          Encaissements
        </Link>
        <span className="text-doux"> / Remise du {jour(r.date)}</span>
      </nav>
      {cree && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm print:hidden">
          Remise créée : imprimez le bordereau et joignez-le au dépôt.
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-doux">{donnees.ecole}</p>
          <h1 className="titre-page">
            Bordereau de remise de {DE_QUOI[r.moyen]} du {jour(r.date)}
          </h1>
          <p className="text-sm">
            {r.nombre} {r.nombre > 1 ? "paiements" : "paiement"}, total{" "}
            <strong className="tabular-nums">{formaterEuros(r.totalCentimes)}</strong>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 print:hidden">
          <Imprimer />
          {role === "direction" && <AnnulerRemise id={r.id} />}
        </div>
      </header>
      <table className="tableau">
        <caption className="sr-only">Paiements remis</caption>
        <thead>
          <tr>
            <th>Payeur</th>
            {r.moyen !== "especes" && <th>N°</th>}
            {r.moyen === "cheque" && <th>Banque ou titulaire</th>}
            <th>Reçu le</th>
            <th className="text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {r.paiements.map((p) => (
            <tr key={p.id}>
              <td>{p.payeur}</td>
              {r.moyen !== "especes" && <td>{p.reference ?? "—"}</td>}
              {r.moyen === "cheque" && <td>{p.emetteur ?? "—"}</td>}
              <td className="whitespace-nowrap">{jour(p.date)}</td>
              <td className="text-right tabular-nums whitespace-nowrap">{formaterEuros(p.montantCentimes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={r.moyen === "cheque" ? 4 : r.moyen === "especes" ? 2 : 3}
              className="px-3 py-2 text-right font-semibold"
            >
              Total
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formaterEuros(r.totalCentimes)}</td>
          </tr>
        </tfoot>
      </table>
    </article>
  );
}
