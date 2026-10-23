import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireEleve } from "@/db/eleves";
import { inscriptionsPayeesPar } from "@/db/inscriptions";
import { paiementsDe, soldeDe } from "@/db/paiements";
import { nomAffiche } from "@/db/personnes";
import { saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { SectionPaiements } from "../../_personnes/paiements";
import {
  Bandeau,
  CoursSuivis,
  Documents,
  InscriptionsFacturees,
  jourDe,
  Notes,
  Telephone,
} from "../../_personnes/sections";
import { Facturation } from "./facturation";
import { Proches } from "./proches";

export const metadata: Metadata = { title: "Fiche élève" };

const BANDEAUX: Record<string, string> = {
  cree: "Élève créé.",
  modifie: "Fiche enregistrée.",
  enregistree: "Inscription enregistrée.",
};

/** Bandeau après un encaissement (`?encaisse=3`). */
const encaisses = (n: unknown) => {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 ? `${k} règlement${k > 1 ? "s" : ""} encaissé${k > 1 ? "s" : ""}.` : undefined;
};

export default async function PageEleve({ params, searchParams }: PageProps<"/eleves/[id]">) {
  const { ecoleId, role } = await exigerRole("direction", "accueil");
  const [{ id }, { enregistre, inscription, encaisse }] = await Promise.all([params, searchParams]);
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const eleve = await lireEleve(tx, id, aujourdhui);
    if (!eleve) return null;
    const saison = await saisonCourante(tx, aujourdhui);
    // Un élève majeur qui paie lui-même voit ici ses inscriptions facturées.
    const paieLuiMeme = eleve.factureA.type !== "personne";
    return {
      eleve,
      saison,
      facturees: saison ? await inscriptionsPayeesPar(tx, eleve.id, saison.id) : [],
      solde: paieLuiMeme ? await soldeDe(tx, eleve.id, aujourdhui) : null,
      paiements: paieLuiMeme ? await paiementsDe(tx, eleve.id) : [],
    };
  });
  if (!donnees) notFound();
  const { eleve: e, saison, facturees, solde, paiements } = donnees;

  const nom = nomAffiche(e);
  const prenom = e.prenom ?? nom;
  const age = e.dateNaissance ? ageAu(e.dateNaissance, aujourdhui) : null;
  const mineur = age !== null && age < 18;
  const urgences = e.responsables
    .filter((r) => r.aPrevenir)
    .concat(e.autres.filter((a) => a.aPrevenir && a.sens === "vers"));
  const bandeau = BANDEAUX[String(inscription ?? enregistre)];

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>
      <Bandeau texte={encaisses(encaisse) ?? bandeau} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{nom}</h1>
          <p className="text-sm text-doux">
            {e.dateNaissance ? `${age} ans, né(e) le ${jourDe(e.dateNaissance)}` : "Date de naissance non renseignée"}
            {!e.eleve && " (contact : pas encore élève)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/eleves/${e.id}/modifier`} className="bouton-secondaire">
            Modifier l’identité
          </Link>
          <Link href={`/eleves/${e.id}/inscription`} className="bouton-principal">
            Inscrire {prenom}
          </Link>
        </div>
      </header>

      <Notes notes={e.notes} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside
          aria-label="Contact et facturation"
          className="order-first flex flex-col gap-4 lg:sticky lg:top-20 lg:order-last"
        >
          <section aria-labelledby="urgence" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="urgence" className="text-sm font-semibold">
              En cas d’urgence
            </h2>
            {urgences.length === 0 ? (
              <span className="text-doux">Personne à prévenir. Cochez « À prévenir » sur un responsable.</span>
            ) : (
              urgences.map((u) => (
                <span key={u.lienId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{u.nom}</span>
                  {u.telephone ? (
                    <Telephone numero={u.telephone} />
                  ) : (
                    <span className="text-erreur">sans téléphone</span>
                  )}
                </span>
              ))
            )}
          </section>
          <Facturation
            eleveId={e.id}
            prenom={prenom}
            mineur={mineur}
            factureA={e.factureA}
            proches={[...e.responsables, ...e.autres.filter((a) => a.sens === "vers")]}
            fratrie={e.fratrie}
          />
          <section aria-labelledby="coordonnees" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="coordonnees" className="text-sm font-semibold">
              Coordonnées de {prenom}
            </h2>
            {e.telephone ? <Telephone numero={e.telephone} /> : <span className="text-doux">Pas de téléphone</span>}
            {e.email ? (
              <a href={`mailto:${e.email}`} className="lien break-all">
                {e.email}
              </a>
            ) : (
              <span className="text-doux">Pas d’e-mail</span>
            )}
            {e.adresse && <span>{e.adresse}</span>}
          </section>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <Proches eleveId={e.id} prenom={prenom} responsables={e.responsables} autres={e.autres} />
          <CoursSuivis cours={e.cours} />
          {saison && <InscriptionsFacturees inscriptions={facturees} saison={saison.libelle} />}
          {e.factureA.type === "personne" ? (
            <p className="text-sm text-doux">
              Paiements : sur la fiche de{" "}
              <Link href={`/contacts/${e.factureA.id}`} className="lien">
                {e.factureA.nom}
              </Link>
              , qui paie pour {prenom}.
            </p>
          ) : (
            <SectionPaiements
              payeurId={e.id}
              solde={solde}
              paiements={paiements}
              retour={`/eleves/${e.id}`}
              direction={role === "direction"}
              aujourdhui={aujourdhui}
            />
          )}
          <Documents documents={e.documents} aujourdhui={aujourdhui} />
        </div>
      </div>
    </article>
  );
}
