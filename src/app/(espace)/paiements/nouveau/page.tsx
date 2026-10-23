import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { isStudent } from "@/db/eleves";
import { balanceOf } from "@/db/paiements";
import { readPerson, nomAffiche } from "@/db/personnes";
import { todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";
import { PaymentForm } from "./formulaire";

export const metadata: Metadata = { title: "Encaisser" };

/** Encaissement pour un payeur (`?payeur=`), ouvert aussi en panneau depuis sa fiche. */
export default async function CollectPaymentPage({ searchParams }: PageProps<"/paiements/nouveau">) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const { payeur } = await searchParams;
  const today = todayInParis();
  const donnees =
    typeof payeur === "string"
      ? await withSchool(schoolId, async (tx) => {
          const p = await readPerson(tx, payeur);
          return p ? { p, student: await isStudent(tx, p.id), balance: await balanceOf(tx, p.id, today) } : null;
        })
      : null;
  if (!donnees) notFound();
  const { p, student: student, balance: balance } = donnees;
  const back = `/${student ? "eleves" : "contacts"}/${p.id}`;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={back} className="lien">
          {nomAffiche(p)}
        </Link>
        <span className="text-doux"> / Encaisser</span>
      </nav>
      <h1 className="titre-page">Encaisser</h1>
      <PaymentForm
        payerId={p.id}
        payer={nomAffiche(p)}
        remaining={balance?.remaining ?? null}
        today={today}
        back={back}
      />
    </section>
  );
}
