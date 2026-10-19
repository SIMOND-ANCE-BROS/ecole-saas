import { contexteEcole, sessionCourante } from "@/lib/session";

const LIBELLE_ROLE = { direction: "direction", accueil: "accueil", professeur: "professeur" } as const;

export default async function Accueil() {
  const [{ user }, contexte] = await Promise.all([sessionCourante(), contexteEcole()]);
  return (
    <section className="flex flex-col gap-2">
      <h1 className="titre-page">Bonjour {user.name}</h1>
      <p className="text-sm text-doux">
        Connecté·e en tant que {LIBELLE_ROLE[contexte.role]}.
      </p>
    </section>
  );
}
