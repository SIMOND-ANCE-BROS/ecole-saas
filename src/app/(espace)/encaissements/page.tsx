import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { MOYENS, type Moyen } from "@/db/paiements";
import { journalEncaissements, listerRemises, paiementsARemettre } from "@/db/remises";
import { MOYENS_REMISE, totaux } from "@/domaine/encaissement/remises";
import { dateValide } from "@/domaine/planning/semaine";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { formaterEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";
import { ARemettre } from "./a-remettre";

export const metadata: Metadata = { title: "Encaissements" };

const VUES = { journal: "Journal", remettre: "À remettre", remises: "Remises" } as const;
type Vue = keyof typeof VUES;
const jour = (iso: string) => iso.split("-").reverse().join("/");

/** Encaissements (#98) : journal par période, paiements à remettre en banque, remises et bordereaux. */
export default async function PageEncaissements({ searchParams }: PageProps<"/encaissements">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const p = await searchParams;
  const vue: Vue = typeof p.vue === "string" && p.vue in VUES ? (p.vue as Vue) : "journal";
  const aujourdhui = aujourdhuiAParis();
  const du = dateValide(p.du) ?? `${aujourdhui.slice(0, 8)}01`;
  const au = dateValide(p.au) ?? aujourdhui;
  const moyen = typeof p.moyen === "string" && p.moyen in MOYENS ? (p.moyen as Moyen) : null;

  const donnees = await avecEcole(ecoleId, async (tx) => ({
    journal: vue === "journal" ? await journalEncaissements(tx, du, au, moyen) : [],
    aRemettre: vue === "remettre" ? await paiementsARemettre(tx, aujourdhui) : null,
    remises: vue === "remises" ? await listerRemises(tx) : [],
  }));
  const t = totaux(donnees.journal);
  const exporter = `/encaissements/export?${new URLSearchParams({ du, au, ...(moyen ? { moyen } : {}) })}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <h1 className="titre-page">Encaissements</h1>
      {p.annulee && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Remise annulée : ses paiements sont de nouveau à remettre.
        </p>
      )}
      <nav aria-label="Vues" className="flex overflow-hidden self-start rounded-md border border-bordure text-sm">
        {(Object.keys(VUES) as Vue[]).map((v) => (
          <Link
            key={v}
            href={`/encaissements?vue=${v}`}
            aria-current={vue === v ? "page" : undefined}
            className={`px-3 py-1.5 ${vue === v ? "bg-accent text-sur-accent" : "hover:bg-accent-doux"}`}
          >
            {VUES[v]}
          </Link>
        ))}
      </nav>

      {vue === "journal" && (
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
              <select id="moyen" name="moyen" className="champ" defaultValue={moyen ?? ""}>
                <option value="">Tous</option>
                {Object.entries(MOYENS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="bouton-secondaire">
              Afficher
            </button>
            <a href={exporter} className="lien ml-auto pb-1.5">
              Exporter (CSV)
            </a>
          </form>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline text-doux">Total : </dt>
              <dd className="inline font-semibold tabular-nums">{formaterEuros(t.total)}</dd>
            </div>
            {Object.entries(t.parMoyen).map(([m, c]) => (
              <div key={m}>
                <dt className="inline text-doux">{MOYENS[m as Moyen]} : </dt>
                <dd className="inline tabular-nums">{formaterEuros(c)}</dd>
              </div>
            ))}
          </dl>
          {donnees.journal.length === 0 ? (
            <p className="text-sm text-doux">Aucun encaissement sur cette période.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <caption className="sr-only">
                  Encaissements du {jour(du)} au {jour(au)}
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
                    <tr key={l.id} className={l.montantCentimes < 0 ? "text-doux" : ""}>
                      <td className="whitespace-nowrap">{jour(l.date)}</td>
                      <td>
                        <Link href={`/personnes/${l.payeurId}`} className="lien">
                          {l.payeur}
                        </Link>
                      </td>
                      <td>{MOYENS[l.moyen]}</td>
                      <td>{[l.reference, l.emetteur].filter(Boolean).join(", ") || "—"}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formaterEuros(l.montantCentimes)}</td>
                      <td className="whitespace-nowrap">
                        {l.encaissementPrevu && l.encaissementPrevu > aujourdhui
                          ? `le ${jour(l.encaissementPrevu)}`
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {l.remiseId ? (
                          <Link href={`/encaissements/remises/${l.remiseId}`} className="lien">
                            {jour(l.remiseDate as string)}
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

      {vue === "remettre" && donnees.aRemettre && (
        <>
          <p className="text-sm text-doux">
            Chèques dont la date d’encaissement est arrivée, espèces et chèques vacances pas encore déposés.
          </p>
          {MOYENS_REMISE.every((m) => donnees.aRemettre![m].length === 0) && (
            <p className="text-sm">Rien à remettre pour l’instant.</p>
          )}
          {MOYENS_REMISE.filter((m) => donnees.aRemettre![m].length > 0).map((m) => (
            <ARemettre key={m} moyen={m} paiements={donnees.aRemettre![m]} aujourdhui={aujourdhui} />
          ))}
        </>
      )}

      {vue === "remises" &&
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
                        {jour(r.date)}
                      </Link>
                    </td>
                    <td>{MOYENS[r.moyen]}</td>
                    <td className="text-right tabular-nums">{r.nombre}</td>
                    <td className="text-right tabular-nums">{formaterEuros(r.totalCentimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
