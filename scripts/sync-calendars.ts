/**
 * Synchronise les agendas connectés de toutes les écoles (tâche planifiée,
 * par exemple toutes les heures) :
 *
 *   npm run calendars:sync
 *
 * Script d'administration : la connexion propriétaire sert seulement à lister
 * les écoles qui ont un agenda connecté ; chaque école est ensuite traitée par
 * l'application, sous sa propre RLS. Aucune donnée personnelle dans la sortie.
 */
import postgres from "postgres";
import { syncSchool } from "../src/lib/calendar-sync";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante");
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function principal() {
  const ecoles = await admin`SELECT DISTINCT school_id AS id FROM calendar_connection`;
  let succeeded = 0;
  let failed = 0;
  for (const { id } of ecoles) {
    const r = await syncSchool(id);
    succeeded += r.succeeded;
    failed += r.failed;
  }
  console.log(`Agendas synchronisés : ${succeeded} ; en échec : ${failed} (écoles : ${ecoles.length}).`);
}

// The application pool (src/db) keeps the process alive: exit explicitly.
void principal()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.end();
    process.exit(process.exitCode ?? 0);
  });
