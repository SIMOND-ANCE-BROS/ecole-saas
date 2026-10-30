import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { isStudent } from "@/db/students";
import { balanceOf } from "@/db/payments";
import { entityChoices } from "@/db/billing-entities";
import { entityOwingMost, familyOwed } from "@/domain/payments/balance";
import { readPerson, displayedName } from "@/db/people";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { TextLink } from "../../_ui/text-link";
import { PaymentForm } from "./payment-form";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Encaisser" };

/** Payment for a payer (`?payeur=`), also opened as a side panel from their record. */
export default async function CollectPaymentPage({ searchParams }: PageProps<"/paiements/nouveau">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const { payeur } = await searchParams;
  const today = todayInParis();
  const parsed =
    typeof payeur === "string"
      ? await withSchool(schoolId, async (tx) => {
          const p = await readPerson(tx, payeur);
          return p
            ? {
                p,
                student: await isStudent(tx, p.id),
                balance: await balanceOf(tx, p.id, today),
                entities: await entityChoices(tx),
              }
            : null;
        })
      : null;
  if (!parsed) notFound();
  const { p, student: student, balance: balance } = parsed;
  const back = `/${student ? "eleves" : "contacts"}/${p.id}`;
  // With several active entities the front desk chooses the one that cashes (#300), preselected
  // on the one the payer owes the most; with one, nothing is shown and the total is what is left.
  const owed = Object.fromEntries((balance?.byEntity ?? []).map((e) => [e.id, e.balance]));
  const entities =
    parsed.entities.length > 1
      ? parsed.entities.map((e) => ({ id: e.id, name: e.name, remaining: owed[e.id]?.remaining ?? 0 }))
      : [];
  const initialEntity = entityOwingMost(
    entities.map((e) => e.id),
    owed,
  );
  // What is left to pay where the payment goes. Several entities of which only one is active:
  // that one's own balance, never the total (a debt to another business is not cashed here).
  const onlyActive = parsed.entities.length === 1 ? parsed.entities[0].id : null;
  const remaining = !balance
    ? null
    : balance.severalEntities && onlyActive
      ? (owed[onlyActive]?.remaining ?? 0)
      : balance.total.remaining;
  // The family's debt over the entities offered, never netted (#300): shown next to the chosen
  // entity's. A deactivated one is left out: it cannot be chosen here (#319).
  const familyRemaining =
    balance && entities.length > 0 ? familyOwed(entities.flatMap((e) => (owed[e.id] ? [owed[e.id]] : []))).owed : null;

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={back} size="sm">
          {displayedName(p)}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Encaisser
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Encaisser
      </Title>
      <PaymentForm
        payerId={p.id}
        payer={displayedName(p)}
        remaining={remaining}
        familyRemaining={familyRemaining}
        entities={entities}
        initialEntity={initialEntity}
        today={today}
        back={back}
      />
    </FormPage>
  );
}
