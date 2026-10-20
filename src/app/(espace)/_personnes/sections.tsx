import Link from "next/link";
import type { InscriptionPayee } from "@/db/inscriptions";
import type { FichePersonne } from "@/db/personnes";
import { LIBELLES_STATUT_INSCRIPTION as STATUT } from "@/domaine/inscription/statuts";
import { formaterEuros } from "@/lib/montant";
import { JOURS } from "../planning/format";

/** Sections communes aux fiches élève et contact. */

const DOCUMENT = {
  certificat_medical: "Certificat médical",
  autorisation_parentale: "Autorisation parentale",
  droit_image: "Droit à l’image",
  autre: "Autre document",
} as const;
const PERIODICITE = { trimestre: "trimestre", annee: "année", unite: "unité" } as const;
const PUBLIC = { enfant: "Enfant", adulte: "Adulte", couple: "Couple", etudiant: "Étudiant" } as const;

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const jourDe = (iso: string) => dateLongue.format(new Date(`${iso}T00:00:00Z`));

export const Telephone = ({ numero }: { numero: string }) => (
  <a href={`tel:${numero.replace(/\s/g, "")}`} className="lien tabular-nums">
    {numero}
  </a>
);

export function Bandeau({ texte }: { texte?: string }) {
  if (!texte) return null;
  return (
    <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
      {texte}
    </p>
  );
}

export function Notes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <section aria-label="Santé et consignes" className="rounded-md border border-alerte-texte/40 bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
      <p className="whitespace-pre-line">{notes}</p>
    </section>
  );
}

export function CoursSuivis({ cours }: { cours: FichePersonne["cours"] }) {
  const saison = cours[0]?.saison;
  const actuels = cours.filter((c) => c.saison === saison);
  const historique = cours.filter((c) => c.saison !== saison);
  return (
    <>
      <section aria-labelledby="cours" className="flex flex-col gap-2">
        <h2 id="cours" className="text-base font-semibold">
          Cours{saison && ` ${saison}`}
        </h2>
        {actuels.length === 0 ? (
          <p className="text-sm text-doux">Aucun cours pour l’instant.</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {actuels.map((c) => (
              <li key={`${c.id}-${c.statut}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <Link href={`/planning/cours/${c.id}`} className="lien font-medium">
                  {c.discipline}
                  {c.niveau && ` ${c.niveau}`}
                </Link>
                <span className="tabular-nums">
                  {c.jourSemaine ? JOURS[c.jourSemaine] : "Stage"} {c.heureDebut}
                </span>
                {c.presents + c.absents > 0 && (
                  <span className={`text-xs ${c.absents > c.presents ? "text-alerte-texte" : "text-doux"}`}>
                    présent {c.presents} fois sur {c.presents + c.absents}
                  </span>
                )}
                <span className={`ml-auto text-xs ${c.statut === "active" ? "text-doux" : "font-medium text-alerte-texte"}`}>{STATUT[c.statut]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {historique.length > 0 && (
        <section aria-labelledby="historique" className="flex flex-col gap-2">
          <h2 id="historique" className="text-base font-semibold">
            Saisons précédentes
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-doux">
            {historique.map((c) => (
              <li key={`${c.id}-${c.statut}`}>
                {c.saison} : {c.discipline}
                {c.niveau && ` ${c.niveau}`} ({STATUT[c.statut].toLowerCase()})
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function Documents({ documents, aujourdhui }: { documents: FichePersonne["documents"]; aujourdhui: string }) {
  return (
    <section aria-labelledby="documents" className="flex flex-col gap-2">
      <h2 id="documents" className="text-base font-semibold">
        Documents
      </h2>
      {documents.length === 0 ? (
        <p className="text-sm text-doux">Aucun document enregistré (certificat médical, autorisations).</p>
      ) : (
        <ul className="panneau divide-y divide-bordure text-sm">
          {documents.map((d, i) => {
            const expire = d.valideJusqu !== null && d.valideJusqu < aujourdhui;
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <span className="font-medium">{DOCUMENT[d.type]}</span>
                <span className={expire || !d.accorde ? "text-alerte-texte" : "text-doux"}>
                  {!d.accorde ? "refusé" : d.valideJusqu ? `${expire ? "expiré le" : "valable jusqu’au"} ${jourDe(d.valideJusqu)}` : "fourni"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Inscriptions facturées à une personne : un engagement, pas un encaissement. */
export function InscriptionsFacturees({ inscriptions, saison }: { inscriptions: InscriptionPayee[]; saison: string }) {
  if (inscriptions.length === 0) return null;
  const total = inscriptions.reduce((s, i) => s + i.prixNetCentimes, 0);
  return (
    <section aria-labelledby="facturees" className="flex flex-col gap-2">
      <h2 id="facturees" className="text-base font-semibold">
        Inscriptions facturées {saison}
      </h2>
      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Élève</th>
              <th scope="col">Cours</th>
              <th scope="col" className="hidden sm:table-cell">
                Formule
              </th>
              <th scope="col" className="text-right">
                Prix
              </th>
            </tr>
          </thead>
          <tbody>
            {inscriptions.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.danseurs}</td>
                <td>{i.cours.join(", ")}</td>
                <td className="hidden sm:table-cell">
                  {PUBLIC[i.public]}, {PERIODICITE[i.periodicite]}
                </td>
                <td className="text-right tabular-nums">{formaterEuros(i.prixNetCentimes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="px-3 py-2 text-right font-medium sm:hidden">
                Total
              </td>
              <td colSpan={3} className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Total de la saison (montant inscrit, ni encaissé ni dû à ce jour)
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{formaterEuros(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
