import type { Metadata } from "next";
import { avecEcole } from "@/db";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/familles/age";
import { contexteEcole } from "@/lib/session";

export const metadata: Metadata = { title: "Planning" };

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function fin(heure: string, duree: number): string {
  const [h, m] = heure.split(":").map(Number);
  const total = h * 60 + m + duree;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function ages(min: number | null, max: number | null): string | null {
  if (min && max) return `${min}–${max} ans`;
  if (min) return `dès ${min} ans`;
  if (max) return `jusqu’à ${max} ans`;
  return null;
}

export default async function PagePlanning() {
  const { ecoleId } = await contexteEcole();
  const { saison, cours } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, cours: s ? await coursDeLaSaison(tx, s.id) : [] };
  });

  if (!saison) {
    return <p className="text-sm">Aucune saison n’est encore paramétrée.</p>;
  }

  const jours = [...new Set(cours.map((c) => c.jourSemaine))];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Planning {saison.libelle}</h1>
      {cours.length === 0 ? (
        <p className="text-sm">Aucun cours pour cette saison.</p>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {jours.map((jour) => (
            <section key={jour ?? "stage"} aria-labelledby={`jour-${jour ?? "stage"}`} className="flex flex-col gap-2">
              <h2 id={`jour-${jour ?? "stage"}`} className="border-b border-neutral-300 pb-1 text-sm font-semibold dark:border-neutral-700">
                {jour ? JOURS[jour] : "Stages"}
              </h2>
              <ul className="flex flex-col gap-2">
                {cours
                  .filter((c) => c.jourSemaine === jour)
                  .map((c) => (
                    <li key={c.id} className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700">
                      <p className="font-medium">
                        <span className="tabular-nums">
                          {c.heureDebut}–{fin(c.heureDebut, c.dureeMinutes)}
                        </span>{" "}
                        {c.discipline}
                      </p>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300">
                        {[c.salle, c.site].join(" · ")} — {c.intervenant}
                      </p>
                      {(ages(c.ageMin, c.ageMax) || c.niveau) && (
                        <p className="text-xs text-neutral-700 dark:text-neutral-300">
                          {[ages(c.ageMin, c.ageMax), c.niveau].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
