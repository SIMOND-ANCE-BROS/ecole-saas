import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Alert,
  Table,
  TableCaption,
  TableTbody,
  TableTd,
  TableTfoot,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { withSchool } from "@/db";
import { readDeposit } from "@/db/deposits";
import { school } from "@/db/schema";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { TextLink } from "../../../_ui/text-link";
import { CancelDeposit, Print } from "./buttons";

export const metadata: Metadata = { title: "Bordereau de remise" };

const day = (iso: string) => iso.split("-").reverse().join("/");
const DEPOSIT_KIND = { cheque: "chèques", cash: "espèces", holiday_voucher: "chèques vacances" } as const;

/** Deposit slip of a bank deposit (#98), to print and enclose with the deposit. */
export default async function DepositPage({ params, searchParams }: PageProps<"/encaissements/remises/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { cree }] = await Promise.all([params, searchParams]);
  const parsed = await withSchool(schoolId, async (tx) => {
    const r = await readDeposit(tx, id);
    const [e] = await tx.select({ name: school.name }).from(school).where(eq(school.id, schoolId));
    return r ? { r, school: e?.name ?? "" } : null;
  });
  if (!parsed) notFound();
  const { r } = parsed;

  return (
    <article className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <TextLink href="/encaissements?vue=remises" size="sm">
          Encaissements
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Remise du {day(r.date)}
        </Text>
      </nav>
      {cree && (
        <Alert role="status" className="print:hidden">
          Remise créée : imprimez le bordereau et joignez-le au dépôt.
        </Alert>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text size="sm" c="dimmed">
            {parsed.school}
          </Text>
          <Title order={1} fz="xl">
            Bordereau de remise de {DEPOSIT_KIND[r.method]} du {day(r.date)}
          </Title>
          <Text size="sm">
            {r.count} {r.count > 1 ? "paiements" : "paiement"}, total{" "}
            <strong className="tabular-nums">{formatEuros(r.totalCents)}</strong>
          </Text>
        </div>
        <div className="flex flex-col items-end gap-2 print:hidden">
          <Print />
          {role === "director" && <CancelDeposit id={r.id} />}
        </div>
      </header>
      <Table>
        <TableCaption className="sr-only">Paiements remis</TableCaption>
        <TableThead>
          <TableTr>
            <TableTh>Payeur</TableTh>
            {r.method !== "cash" && <TableTh>N°</TableTh>}
            {r.method === "cheque" && <TableTh>Banque ou titulaire</TableTh>}
            <TableTh>Reçu le</TableTh>
            <TableTh ta="right">Montant</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {r.payments.map((p) => (
            <TableTr key={p.id}>
              <TableTd>{p.payer}</TableTd>
              {r.method !== "cash" && <TableTd>{p.reference ?? "—"}</TableTd>}
              {r.method === "cheque" && <TableTd>{p.issuer ?? "—"}</TableTd>}
              <TableTd className="whitespace-nowrap">{day(p.date)}</TableTd>
              <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                {formatEuros(p.amountCents)}
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
        <TableTfoot>
          <TableTr>
            <TableTd colSpan={r.method === "cheque" ? 4 : r.method === "cash" ? 2 : 3} ta="right" fw={600}>
              Total
            </TableTd>
            <TableTd ta="right" fw={600} className="tabular-nums">
              {formatEuros(r.totalCents)}
            </TableTd>
          </TableTr>
        </TableTfoot>
      </Table>
    </article>
  );
}
