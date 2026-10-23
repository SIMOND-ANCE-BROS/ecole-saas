import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readDeposit } from "@/db/deposits";
import { school } from "@/db/schema";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { CancelDeposit, Print } from "./buttons";

export const metadata: Metadata = { title: "Bordereau de remise" };

const day = (iso: string) => iso.split("-").reverse().join("/");
const DEPOSIT_KIND = { cheque: "chèques", especes: "espèces", cheque_vacances: "chèques vacances" } as const;

/** Bordereau d'une remise en banque (#98), à imprimer et à joindre au dépôt. */
export default async function DepositPage({ params, searchParams }: PageProps<"/encaissements/remises/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("direction", "accueil");
  const [{ id }, { cree }] = await Promise.all([params, searchParams]);
  const donnees = await withSchool(schoolId, async (tx) => {
    const r = await readDeposit(tx, id);
    const [e] = await tx.select({ name: school.name }).from(school).where(eq(school.id, schoolId));
    return r ? { r, school: e?.name ?? "" } : null;
  });
  if (!donnees) notFound();
  const { r } = donnees;

  return (
    <article className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <Link href="/encaissements?vue=remises" className="lien">
          Encaissements
        </Link>
        <span className="text-doux"> / Remise du {day(r.date)}</span>
      </nav>
      {cree && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm print:hidden">
          Remise créée : imprimez le bordereau et joignez-le au dépôt.
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-doux">{donnees.school}</p>
          <h1 className="titre-page">
            Bordereau de remise de {DEPOSIT_KIND[r.method]} du {day(r.date)}
          </h1>
          <p className="text-sm">
            {r.nombre} {r.nombre > 1 ? "paiements" : "paiement"}, total{" "}
            <strong className="tabular-nums">{formatEuros(r.totalCents)}</strong>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 print:hidden">
          <Print />
          {role === "direction" && <CancelDeposit id={r.id} />}
        </div>
      </header>
      <table className="tableau">
        <caption className="sr-only">Paiements remis</caption>
        <thead>
          <tr>
            <th>Payeur</th>
            {r.method !== "especes" && <th>N°</th>}
            {r.method === "cheque" && <th>Banque ou titulaire</th>}
            <th>Reçu le</th>
            <th className="text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {r.payments.map((p) => (
            <tr key={p.id}>
              <td>{p.payer}</td>
              {r.method !== "especes" && <td>{p.reference ?? "—"}</td>}
              {r.method === "cheque" && <td>{p.issuer ?? "—"}</td>}
              <td className="whitespace-nowrap">{day(p.date)}</td>
              <td className="text-right tabular-nums whitespace-nowrap">{formatEuros(p.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={r.method === "cheque" ? 4 : r.method === "especes" ? 2 : 3}
              className="px-3 py-2 text-right font-semibold"
            >
              Total
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatEuros(r.totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </article>
  );
}
