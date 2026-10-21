import { avecEcole } from "@/db";
import { MOYENS, type Moyen } from "@/db/paiements";
import { journalEncaissements } from "@/db/remises";
import { versCsv } from "@/domaine/encaissement/remises";
import { dateValide } from "@/domaine/planning/semaine";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

/** Export CSV du journal des encaissements (`?du=&au=&moyen=`), pour la comptabilité (#98). */
export async function GET(requete: Request) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const p = new URL(requete.url).searchParams;
  const aujourdhui = aujourdhuiAParis();
  const du = dateValide(p.get("du")) ?? aujourdhui;
  const au = dateValide(p.get("au")) ?? aujourdhui;
  const m = p.get("moyen");
  const moyen = m && m in MOYENS ? (m as Moyen) : null;
  const lignes = await avecEcole(ecoleId, (tx) => journalEncaissements(tx, du, au, moyen));
  const csv = versCsv(
    lignes.map((l) => ({
      date: l.date,
      payeur: l.payeur,
      moyen: MOYENS[l.moyen],
      montantCentimes: l.montantCentimes,
      reference: l.reference,
      emetteur: l.emetteur,
      encaissementPrevu: l.encaissementPrevu,
      remise: l.remiseDate,
    })),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="encaissements-${du}-${au}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
