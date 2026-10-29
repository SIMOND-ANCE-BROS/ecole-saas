/**
 * DEMO data for local development: a fictitious school and
 * two accounts (front desk, management). Idempotent. Never run in production.
 *
 *   npm run db:seed
 */
import postgres from "postgres";
import { withSchool } from "../src/db";
import { syncLessons } from "../src/db/lessons";
import { todayInParis } from "../src/domain/people/age";
import { createAccount } from "../src/lib/accounts";

const PASSWORD = process.env.SEED_MOT_DE_PASSE ?? "demo-ecole-de-danse";
const ACCOUNTS = [
  { email: "accueil@demo.test", name: "Accueil Démo", role: "front_desk" },
  { email: "direction@demo.test", name: "Direction Démo", role: "director" },
] as const;

/** A payer and the students whose courses they pay for. */
type DemoFamily = {
  name: string;
  firstName?: string;
  type?: "individual" | "organisation";
  companyName?: string;
  siren?: string;
  email?: string;
  telephone?: string;
  address?: string;
  students: [prenom: string, naissance: string | null][];
};

const FAMILIES: DemoFamily[] = [
  {
    name: "Lefèvre",
    firstName: "Hélène",
    email: "helene.lefevre@demo.test",
    telephone: "06 12 34 56 78",
    address: "12 rue des Lilas, 69100 Villeurbanne",
    students: [
      ["Zoé", "2015-03-10"],
      ["Noé", "2017-11-02"],
    ],
  },
  {
    name: "Martin",
    firstName: "Paul",
    email: "paul.martin@demo.test",
    telephone: "06 98 76 54 32",
    students: [["Léa", "2014-06-21"]],
  },
  {
    name: "Bernard",
    firstName: "Émilie",
    telephone: "07 11 22 33 44",
    students: [
      ["Alice", "2016-01-15"],
      ["Louis", "2016-01-15"],
      ["Jules", "2019-09-30"],
    ],
  },
  { name: "Rivière", firstName: "Alex", email: "alex.riviere@demo.test", students: [["Alex", "1996-04-05"]] },
  { name: "Petit", firstName: "Sarah", telephone: "06 55 44 33 22", students: [["Chloé", "2013-12-24"]] },
  {
    name: "Ateliers Démo",
    type: "organisation",
    companyName: "CSE des Ateliers Démo",
    siren: "000000000",
    email: "cse@demo.test",
    students: [],
  },
];

if (process.env.NODE_ENV === "production") throw new Error("Données de démonstration refusées en production");
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const [school] = await admin`
    INSERT INTO school (name, slug) VALUES ('École de démonstration', 'demo')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  // Its default billing entity (#298): created here, never by a trigger on school.
  await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, bank_account_label, is_default)
    SELECT ${school.id}, 'Danse Démo', 'Danse Démo EI', 'not_applicable', 'Compte courant Banque Démo', true
    WHERE NOT EXISTS (SELECT 1 FROM billing_entity WHERE school_id = ${school.id})`;
  await admin`
    INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school.id}, '2026-2027', '2026-09-01', '2027-06-30')
    ON CONFLICT DO NOTHING`;

  for (const account of ACCOUNTS) {
    const [existing] = await admin`SELECT id FROM "user" WHERE email = ${account.email}`;
    const userId: string =
      existing?.id ?? (await createAccount({ email: account.email, name: account.name, password: PASSWORD }));
    await admin`
      INSERT INTO member (school_id, user_id, role) VALUES (${school.id}, ${userId}, ${account.role})
      ON CONFLICT (school_id, user_id) DO NOTHING`;
  }

  // Fictitious people (no real person), created only once. A student
  // who bears the payer's first name is the payer themselves (adult on their own).
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM person WHERE school_id = ${school.id}`;
  if (n === 0) {
    for (const f of FAMILIES) {
      const [p] = await admin`
        INSERT INTO person (school_id, type, last_name, first_name, company_name, siren, email, phone, address)
        VALUES (${school.id}, ${f.type ?? "individual"}, ${f.name}, ${f.firstName ?? null}, ${f.companyName ?? null},
                ${f.siren ?? null}, ${f.email ?? null}, ${f.telephone ?? null}, ${f.address ?? null})
        RETURNING id`;
      for (const [firstName, birth] of f.students) {
        if (firstName === f.firstName) {
          await admin`UPDATE person SET birth_date = ${birth}, is_student = true WHERE id = ${p.id}`;
          continue;
        }
        const [d] = await admin`
          INSERT INTO person (school_id, last_name, first_name, birth_date, is_student)
          VALUES (${school.id}, ${f.name}, ${firstName}, ${birth}, true) RETURNING id`;
        await admin`
          INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for, emergency_contact)
          VALUES (${school.id}, ${p.id}, ${d.id}, 'legal_guardian', true, true)`;
      }
    }
  }

  // Fictitious schedule: sites, rooms, disciplines, teachers, courses of the season.
  const [season] = await admin`SELECT id FROM season WHERE school_id = ${school.id} AND label = '2026-2027'`;
  const [{ nbCours: courseCount }] =
    await admin`SELECT count(*)::int AS "nbCours" FROM course WHERE season_id = ${season.id}`;
  if (courseCount === 0) {
    const sites: Record<string, string> = {};
    for (const [name, address, permanence] of [
      ["Site Centre", "3 place de la Mairie, 69100 Villeurbanne", true],
      ["Site Nord", "40 avenue des Arts, 69100 Villeurbanne", false],
    ] as const) {
      const [s] =
        await admin`INSERT INTO site (school_id, name, address, enrollment_desk) VALUES (${school.id}, ${name}, ${address}, ${permanence}) RETURNING id`;
      sites[name] = s.id;
    }
    const rooms: Record<string, string> = {};
    for (const [name, site, capacity] of [
      ["Grande salle", "Site Centre", 30],
      ["Petite salle", "Site Centre", 15],
      ["Studio", "Site Nord", 20],
    ] as const) {
      const [s] =
        await admin`INSERT INTO room (school_id, site_id, name, capacity) VALUES (${school.id}, ${sites[site]}, ${name}, ${capacity}) RETURNING id`;
      rooms[name] = s.id;
    }
    const disciplines: Record<string, string> = {};
    for (const name of ["Éveil", "Classique", "Jazz", "Contemporain", "Zumba", "Salsa"]) {
      const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school.id}, ${name})
        ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      disciplines[name] = d.id;
    }
    const profs: Record<string, string> = {};
    for (const [firstName, name, status, mode, tariff] of [
      ["Camille", "Durand", "sole_trader", "hourly", 4000],
      ["Mathis", "Roux", "sole_trader", "per_lesson", 3500],
      ["Inès", "Garnier", "employee", "hourly", 2800],
      ["Lucas", "Faure", "company", "hourly", 4500],
    ] as const) {
      const [p] = await admin`
        INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${school.id}, ${name}, ${firstName}, ${status}, 'not_applicable', ${mode}, ${tariff}) RETURNING id`;
      profs[firstName] = p.id;
    }
    // [discipline, room, teacher, day (1 = Monday), time, duration, min age, max age, level]
    const COURSE = [
      ["Éveil", "Petite salle", "Inès", 3, "14:00", 45, 4, 5, null],
      ["Éveil", "Petite salle", "Inès", 6, "10:00", 45, 4, 5, null],
      ["Classique", "Grande salle", "Camille", 3, "15:00", 60, 6, 8, "Débutant"],
      ["Classique", "Grande salle", "Camille", 3, "16:15", 60, 9, 12, "Intermédiaire"],
      ["Classique", "Grande salle", "Camille", 5, "17:30", 90, 13, null, "Avancé"],
      ["Jazz", "Grande salle", "Mathis", 1, "17:00", 60, 8, 11, null],
      ["Jazz", "Studio", "Mathis", 2, "18:00", 60, 12, 15, null],
      ["Jazz", "Studio", "Mathis", 4, "19:30", 90, 16, null, "Adultes"],
      ["Contemporain", "Studio", "Inès", 2, "19:15", 90, 16, null, "Adultes"],
      ["Contemporain", "Grande salle", "Camille", 6, "11:00", 60, 10, 14, null],
      ["Zumba", "Grande salle", "Lucas", 1, "19:00", 60, 16, null, "Adultes"],
      ["Zumba", "Grande salle", "Lucas", 4, "19:00", 60, 16, null, "Adultes"],
      ["Salsa", "Studio", "Lucas", 3, "20:00", 60, 18, null, "Débutant"],
      ["Salsa", "Studio", "Lucas", 5, "20:00", 90, 18, null, "Intermédiaire"],
    ] as const;
    for (const [d, room, teacher, day, time, duration, ageMin, ageMax, level] of COURSE) {
      await admin`
        INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes, age_min, age_max, level)
        VALUES (${school.id}, (SELECT id FROM billing_entity WHERE school_id = ${school.id} AND is_default), ${season.id}, ${disciplines[d]}, ${rooms[room]}, ${profs[teacher]}, ${day}, ${time}, ${duration}, ${ageMin}, ${ageMax}, ${level})`;
    }
  }

  // Capacity of the demo courses: that of their room, if not set.
  await admin`
    UPDATE course SET max_capacity = s.capacity FROM room s
    WHERE course.room_id = s.id AND course.school_id = ${school.id} AND course.max_capacity IS NULL`;

  // Demo tariff grid and siblings discount (amounts in euros).
  const [{ tariffCount }] =
    await admin`SELECT count(*)::int AS "tariffCount" FROM tariff WHERE season_id = ${season.id}`;
  if (tariffCount === 0) {
    const GRID: [audience: string, combination: number[], quarter: number, year: number][] = [
      ["child", [45], 85, 210],
      ["child", [60], 110, 280],
      ["child", [90], 150, 380],
      ["child", [45, 60], 165, 415],
      ["child", [60, 60], 185, 475],
      ["child", [60, 90], 220, 560],
      ["child", [45, 90], 200, 500],
      ["child", [90, 90], 255, 645],
      ["child", [60, 60, 60], 230, 590],
      ["adult", [60], 120, 305],
      ["adult", [90], 165, 420],
      ["adult", [60, 60], 205, 520],
      ["adult", [60, 90], 240, 615],
      ["adult", [90, 90], 280, 715],
      ["couple", [60], 230, 550],
      ["couple", [90], 295, 755],
      ["student", [60], 115, 290],
      ["student", [90], 155, 400],
    ];
    for (const [tariffAudience, combination, quarter, year] of GRID) {
      for (const [period, euros] of [
        ["quarter", quarter],
        ["year", year],
      ] as const) {
        await admin`
          INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
          VALUES (${school.id}, ${season.id}, ${tariffAudience}, ${period}, ${`{${combination.join(",")}}`}::smallint[], ${euros * 100})`;
      }
    }
    await admin`
      INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
      VALUES (${school.id}, ${season.id}, 'fratrie', 1000, 2, '{child}', false)`;
  }

  // Demo closures (fictitious dates) then upcoming lessons, as the application creates them.
  const [{ nbFermetures: closureCount }] =
    await admin`SELECT count(*)::int AS "nbFermetures" FROM closure WHERE season_id = ${season.id}`;
  if (closureCount === 0) {
    for (const [label, start, end] of [
      ["Vacances d’automne", "2026-10-17", "2026-11-01"],
      ["Jour férié", "2026-11-11", "2026-11-11"],
      ["Vacances de fin d’année", "2026-12-19", "2027-01-03"],
    ]) {
      await admin`INSERT INTO closure (school_id, season_id, label, start_date, end_date) VALUES (${school.id}, ${season.id}, ${label}, ${start}, ${end})`;
    }
  }
  const { added: added } = await withSchool(school.id, (tx) => syncLessons(tx, season.id, todayInParis()));
  console.log(`Séances à venir créées : ${added}`);

  console.log(`École de démonstration prête. Comptes : ${ACCOUNTS.map((c) => c.email).join(", ")}`);
  console.log(`Mot de passe : ${process.env.SEED_MOT_DE_PASSE ? "(SEED_MOT_DE_PASSE)" : PASSWORD}`);
}

// The application pool (src/db) keeps the process alive: exit explicitly.
void main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.end();
    process.exit(process.exitCode ?? 0);
  });
