import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { paymentLog, listDeposits, paymentsToDeposit } from "@/db/deposits";
import { DEPOSIT_METHODS, totals } from "@/domain/payments/deposits";
import { validDate } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { ToDeposit } from "./to-deposit";

export const metadata: Metadata = { title: "Encaissements" };

const VIEWS = { journal: "Journal", remettre: "À remettre", remises: "Remises" } as const;
type View = keyof typeof VIEWS;
const day = (iso: string) => iso.split("-").reverse().join("/");

/** Payments (#98): log by period, payments to deposit at the bank, bank deposits and deposit slips. */
export default async function PaymentsPage({ searchParams }: PageProps<"/encaissements">) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const p = await searchParams;
  const view: View = typeof p.vue === "string" && p.vue in VIEWS ? (p.vue as View) : "journal";
  const today = todayInParis();
  const du = validDate(p.du) ?? `${today.slice(0, 8)}01`;
  const au = validDate(p.au) ?? today;
  const method = typeof p.moyen === "string" && p.moyen in PAYMENT_METHODS ? (p.moyen as Method) : null;

  const donnees = await withSchool(schoolId, async (tx) => ({
    journal: view === "journal" ? await paymentLog(tx, du, au, method) : [],
    toDeposit: view === "remettre" ? await paymentsToDeposit(tx, today) : null,
    remises: view === "remises" ? await listDeposits(tx) : [],
  }));
  const t = totals(donnees.journal);
  const exportUrl = `/encaissements/export?${new URLSearchParams({ du, au, ...(method ? { moyen: method } : {}) })}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <h1 className="titre-page">Encaissements</h1>
      {p.annulee && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Remise annulée : ses paiements sont de nouveau à remettre.
        </p>
      )}
      <nav aria-label="Vues" className="flex overflow-hidden self-start rounded-md border border-bordure text-sm">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/encaissements?vue=${v}`}
            aria-current={view === v ? "page" : undefined}
            className={`px-3 py-1.5 ${view === v ? "bg-accent text-sur-accent" : "hover:bg-accent-doux"}`}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </nav>

      {view === "journal" && (
        <>
          <form className="panneau flex flex-wrap items-end gap-3 p-3 text-sm" role="search">
            <input type="hidden" name="vue" value="journal" />
            <div className="flex flex-col gap-1">
              <label htmlFor="du" className="text-xs text-doux">
                Du
              </label>
              <input id="du" name="du" type="date" className="champ" defaultValue={du} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="au" className="text-xs text-doux">
                Au
              </label>
              <input id="au" name="au" type="date" className="champ" defaultValue={au} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="moyen" className="text-xs text-doux">
                Moyen
              </label>
              <select id="moyen" name="moyen" className="champ" defaultValue={method ?? ""}>
                <option value="">Tous</option>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="bouton-secondaire">
              Afficher
            </button>
            <a href={exportUrl} className="lien ml-auto pb-1.5">
              Exporter (CSV)
            </a>
          </form>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline text-doux">Total : </dt>
              <dd className="inline font-semibold tabular-nums">{formatEuros(t.total)}</dd>
            </div>
            {Object.entries(t.byMethod).map(([m, c]) => (
              <div key={m}>
                <dt className="inline text-doux">{PAYMENT_METHODS[m as Method]} : </dt>
                <dd className="inline tabular-nums">{formatEuros(c)}</dd>
              </div>
            ))}
          </dl>
          {donnees.journal.length === 0 ? (
            <p className="text-sm text-doux">Aucun encaissement sur cette période.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <caption className="sr-only">
                  Encaissements du {day(du)} au {day(au)}
                </caption>
                <thead>
                  <tr>
                    <th>Reçu le</th>
                    <th>Payeur</th>
                    <th>Moyen</th>
                    <th>Référence</th>
                    <th className="text-right">Montant</th>
                    <th>Encaissement</th>
                    <th>Remise</th>
                  </tr>
                </thead>
                <tbody>
                  {donnees.journal.map((l) => (
                    <tr key={l.id} className={l.amountCents < 0 ? "text-doux" : ""}>
                      <td className="whitespace-nowrap">{day(l.date)}</td>
                      <td>
                        <Link href={`/personnes/${l.payerId}`} className="lien">
                          {l.payer}
                        </Link>
                      </td>
                      <td>{PAYMENT_METHODS[l.method]}</td>
                      <td>{[l.reference, l.issuer].filter(Boolean).join(", ") || "—"}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formatEuros(l.amountCents)}</td>
                      <td className="whitespace-nowrap">
                        {l.plannedPayment && l.plannedPayment > today ? `le ${day(l.plannedPayment)}` : "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {l.depositId ? (
                          <Link href={`/encaissements/remises/${l.depositId}`} className="lien">
                            {day(l.dateDeposit as string)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === "remettre" && donnees.toDeposit && (
        <>
          <p className="text-sm text-doux">
            Chèques dont la date d’encaissement est arrivée, espèces et chèques vacances pas encore déposés.
          </p>
          {DEPOSIT_METHODS.every((m) => donnees.toDeposit![m].length === 0) && (
            <p className="text-sm">Rien à remettre pour l’instant.</p>
          )}
          {DEPOSIT_METHODS.filter((m) => donnees.toDeposit![m].length > 0).map((m) => (
            <ToDeposit key={m} method={m} payments={donnees.toDeposit![m]} today={today} />
          ))}
        </>
      )}

      {view === "remises" &&
        (donnees.remises.length === 0 ? (
          <p className="text-sm text-doux">Aucune remise pour l’instant.</p>
        ) : (
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <caption className="sr-only">Remises en banque</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Moyen</th>
                  <th className="text-right">Paiements</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {donnees.remises.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/encaissements/remises/${r.id}`} className="lien">
                        {day(r.date)}
                      </Link>
                    </td>
                    <td>{PAYMENT_METHODS[r.method]}</td>
                    <td className="text-right tabular-nums">{r.nombre}</td>
                    <td className="text-right tabular-nums">{formatEuros(r.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
