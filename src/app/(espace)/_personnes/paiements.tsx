import Link from "next/link";
import { type LignePaiement, MOYENS } from "@/db/paiements";
import type { Solde } from "@/domaine/encaissement/solde";
import { formaterEuros } from "@/lib/montant";
import { CorrigerPaiement } from "./corriger";

const dateCourte = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const jour = (iso: string) => dateCourte.format(new Date(`${iso}T00:00:00Z`));
const HORS_CALCUL = { abandon: "abandonnées", essai: "à l’essai", liste_attente: "en liste d’attente" } as const;

type Props = {
  payeurId: string;
  solde: Solde | null;
  paiements: LignePaiement[];
  /** Fiche où revenir après un encaissement. */
  retour: string;
  /** Direction : peut corriger un paiement. */
  direction: boolean;
  aujourdhui: string;
};

/** Paiements d'un payeur (#97) : solde, chèques à encaisser, règlements reçus, corrections. */
export function SectionPaiements({ payeurId, solde, paiements, retour, direction, aujourdhui }: Props) {
  return (
    <section aria-labelledby="paiements" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="paiements" className="text-base font-semibold">
          Paiements
        </h2>
        <Link href={`/paiements/nouveau?payeur=${payeurId}`} className="bouton-principal">
          Encaisser
        </Link>
      </div>
      {solde && (
        <dl className="panneau grid grid-cols-3 gap-2 p-3 text-sm">
          <div>
            <dt className="text-xs text-doux">Dû</dt>
            <dd className="font-medium tabular-nums">{formaterEuros(solde.du)}</dd>
          </div>
          <div>
            <dt className="text-xs text-doux">Payé</dt>
            <dd className="font-medium tabular-nums">{formaterEuros(solde.paye)}</dd>
          </div>
          <div>
            <dt className="text-xs text-doux">{solde.reste < 0 ? "Trop-perçu" : "Reste à payer"}</dt>
            <dd className={`font-semibold tabular-nums ${solde.reste > 0 ? "text-alerte-texte" : ""}`}>
              {formaterEuros(Math.abs(solde.reste))}
            </dd>
          </div>
          {solde.aEncaisser > 0 && (
            <p className="col-span-3 text-xs text-doux">
              Dont {formaterEuros(solde.aEncaisser)} en chèques à encaisser plus tard.
            </p>
          )}
          {Object.entries(solde.horsCalcul).map(([statut, montant]) => (
            <p key={statut} className="col-span-3 text-xs text-doux">
              Inscriptions {HORS_CALCUL[statut as keyof typeof HORS_CALCUL] ?? statut} : {formaterEuros(montant ?? 0)},
              non comptées dans le dû.
            </p>
          ))}
        </dl>
      )}
      {paiements.length === 0 ? (
        <p className="text-sm text-doux">Aucun paiement enregistré.</p>
      ) : (
        <div className="panneau overflow-x-auto">
          <table className="tableau">
            <caption className="sr-only">Paiements reçus</caption>
            <thead>
              <tr>
                <th>Reçu le</th>
                <th>Moyen</th>
                <th>Référence</th>
                <th className="text-right">Montant</th>
                <th>Encaissement</th>
                {direction && <th>Correction</th>}
              </tr>
            </thead>
            <tbody>
              {paiements.map((p) => {
                const restant = p.montantCentimes - p.corrigeCentimes;
                return (
                  <tr key={p.id} className={p.montantCentimes < 0 ? "text-doux" : ""}>
                    <td className="whitespace-nowrap">{jour(p.date)}</td>
                    <td>{MOYENS[p.moyen]}</td>
                    <td>{[p.reference, p.emetteur].filter(Boolean).join(", ") || "—"}</td>
                    <td className="text-right tabular-nums whitespace-nowrap">{formaterEuros(p.montantCentimes)}</td>
                    <td className="whitespace-nowrap">
                      {p.montantCentimes < 0
                        ? "correction"
                        : p.encaissementPrevu && p.encaissementPrevu > aujourdhui
                          ? `le ${jour(p.encaissementPrevu)}`
                          : "encaissé"}
                    </td>
                    {direction && (
                      <td>
                        {p.montantCentimes > 0 && restant > 0 ? (
                          <CorrigerPaiement paiementId={p.id} restant={restant} retour={retour} />
                        ) : p.corrigeCentimes > 0 ? (
                          <span className="text-xs text-doux">corrigé</span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
