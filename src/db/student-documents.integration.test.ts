import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveRequirements, missingDocuments, validUntilFor } from "../domain/people/documents";
import { withSchool } from "./index";
import {
  firstEnrollmentDate,
  readRequirements,
  receiveToday,
  removeDocument,
  saveDocument,
  saveRequirements,
  studentDocuments,
} from "./student-documents";
import { listStudents } from "./students";

/**
 * Documents received for each student (#287), as the application runs them
 * (app_user, RLS): one row per student and type, the school's requirements,
 * the audit log, and the students list's « Documents manquants ». Fictitious
 * data deleted at the end; the audit log being immutable, the cleanup disables
 * its trigger inside an administration transaction, as the other tests do.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const TODAY = "2026-10-29";
const suffix = Math.random().toString(36).slice(2, 8);
const desk = `documents-accueil-${suffix}`;
let school: string;
let otherSchool: string;
let season: string;
let zoe: string; // minor, enrolled on 2026-09-05: the certificate is overdue since 2026-09-21
let alex: string; // adult, on trial since 2026-10-20: due until 2026-11-04
let noe: string; // minor, not enrolled
let foreign: string; // other school's student

async function student(schoolId: string, firstName: string, birthDate: string) {
  const [{ id }] = await admin`INSERT INTO person (school_id, last_name, first_name, birth_date, is_student)
    VALUES (${schoolId}, 'Zzdoc', ${firstName}, ${birthDate}, true) RETURNING id`;
  return id as string;
}

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`da-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`db-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${desk}, 'Zzfaux Test', ${`${desk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${desk}, 'front_desk')`;
  zoe = await student(school, "Zoé", "2015-03-10");
  alex = await student(school, "Alex", "1996-04-05");
  noe = await student(school, "Noé", "2017-11-02");
  foreign = await student(otherSchool, "Inconnue", "2014-01-01");

  [{ id: season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Roux', 'Mathis', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  for (const [who, status, enrolledOn] of [
    [zoe, "active", "2026-09-05"],
    [alex, "trial", "2026-10-20"],
    [noe, "waitlist", "2026-09-01"],
  ] as const) {
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status, enrolled_on)
      VALUES (${school}, ${season}, ${who}, 'child', 'quarter', 10000, ${status}, ${enrolledOn}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${who}, ${jazz.id})`;
  }
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "student_document",
    "document_requirement",
    "enrollment_course",
    "enrollment",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
    "person",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${desk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const as = <T>(fn: Parameters<typeof withSchool<T>>[1]) => withSchool(school, fn);
const auditOf = (rowId: string) =>
  admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
    WHERE school_id = ${school} AND target_table = 'student_document' AND row_id = ${rowId} ORDER BY id`;
const missingColumn = async (today = TODAY) => {
  const requirements = await as((tx) => readRequirements(tx));
  const rows = await as((tx) => listStudents(tx, "", { today, seasonId: season, requirements }));
  return Object.fromEntries(rows.map((r) => [r.firstName, r.missingDocuments]));
};

describe("requirements", () => {
  it("follow the defaults until the school saves its own, which stay within the school", async () => {
    expect(await as((tx) => readRequirements(tx))).toEqual(effectiveRequirements([]));

    const changed = effectiveRequirements([]).map((r) =>
      r.type === "medical_certificate" ? { ...r, validityMonths: 12, dueWithinDays: 30 } : r,
    );
    expect(await as((tx) => saveRequirements(tx, desk, changed))).toEqual({ ok: true });
    expect((await as((tx) => readRequirements(tx)))[0]).toMatchObject({ validityMonths: 12, dueWithinDays: 30 });
    expect((await withSchool(otherSchool, (tx) => readRequirements(tx)))[0]).toMatchObject({
      validityMonths: 36,
      dueWithinDays: 15,
    });

    // Only the type that changed is written, with what it was before.
    const logged = await admin`SELECT before, after FROM audit_log
      WHERE school_id = ${school} AND target_table = 'document_requirement'`;
    expect(logged).toHaveLength(1);
    expect(logged[0].before).toMatchObject({ type: "medical_certificate", validityMonths: 36, dueWithinDays: 15 });
    expect(logged[0].after).toMatchObject({ type: "medical_certificate", validityMonths: 12, dueWithinDays: 30 });

    await as((tx) => saveRequirements(tx, desk, effectiveRequirements([])));
  });

  it("cannot be written for another school, even by naming it", async () => {
    await expect(
      withSchool(school, (tx) =>
        tx.execute(
          sql`INSERT INTO document_requirement (school_id, type, required, minors_only, due_within_days)
            VALUES (${otherSchool}, 'image_rights', false, false, 15)`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } }); // insufficient_privilege: the RLS policy
  });
});

describe("documents of a student", () => {
  it("records a certificate valid three years from its own date (the school's example), once, in the audit log", async () => {
    // Handed in today, dated 2025-09-10: valid until 2028-09-09, whatever the day it was brought.
    const certificate = {
      type: "medical_certificate",
      receivedOn: TODAY,
      datedOn: "2025-09-10",
      validUntil: validUntilFor("2025-09-10", 36),
      granted: true,
    } as const;
    expect(certificate.validUntil).toBe("2028-09-09");
    // Two people saving it at the same time: one row, and the audit log sees the state each one replaced.
    const saves = await Promise.all([
      as((tx) => saveDocument(tx, desk, zoe, certificate, TODAY)),
      as((tx) => saveDocument(tx, desk, zoe, certificate, TODAY)),
    ]);
    expect(saves).toEqual([{ ok: true }, { ok: true }]);
    const docs = await as((tx) => studentDocuments(tx, zoe));
    expect(docs).toEqual([
      {
        id: expect.any(String),
        type: "medical_certificate",
        receivedOn: TODAY,
        datedOn: "2025-09-10",
        granted: true,
        validUntil: "2028-09-09",
      },
    ]);
    const log = await auditOf(docs[0].id);
    expect(log.map((l) => l.action)).toEqual(["insert", "update"]);
    expect(log[0]).toMatchObject({ before: null, has_actor: true });
    expect(log[1].before).toMatchObject({ datedOn: "2025-09-10" });
    expect(log[0].after).toMatchObject({ studentId: zoe, type: "medical_certificate", receivedOn: TODAY });
  });

  it("needs the date of a document whose validity runs from it: no one-click receipt", async () => {
    expect(await as((tx) => receiveToday(tx, desk, alex, "medical_certificate", TODAY))).toEqual({
      ok: false,
      message: "Indiquez la date du document.",
    });
    expect(await as((tx) => studentDocuments(tx, alex))).toEqual([]);
  });

  it("records documents of students only, not of their contacts", async () => {
    const [{ id: parent }] = await admin`INSERT INTO person (school_id, last_name, first_name)
      VALUES (${school}, 'Zzdoc', 'Parent') RETURNING id`;
    expect(await as((tx) => receiveToday(tx, desk, parent, "image_rights", TODAY))).toEqual({
      ok: false,
      message: "Cet élève n’existe plus.",
    });
  });

  it("corrects the dates and the family's answer, keeping the previous state in the audit log", async () => {
    const entry = {
      type: "image_rights",
      receivedOn: "2026-09-12",
      datedOn: null,
      validUntil: null,
      granted: false,
    } as const;
    expect(await as((tx) => saveDocument(tx, desk, zoe, entry, TODAY))).toEqual({ ok: true });
    const fixed = { ...entry, granted: true };
    expect(await as((tx) => saveDocument(tx, desk, zoe, fixed, TODAY))).toEqual({ ok: true });
    const [doc] = (await as((tx) => studentDocuments(tx, zoe))).filter((d) => d.type === "image_rights");
    expect(doc).toMatchObject({ receivedOn: "2026-09-12", granted: true, validUntil: null });
    const log = await auditOf(doc.id);
    expect(log[1].before).toMatchObject({ granted: false });
    expect(log[1].after).toMatchObject({ granted: true });
  });

  it("refuses a reception date in the future, a document dated after it or a validity ending before its date", async () => {
    const base = { type: "parental_consent", granted: true, datedOn: null, validUntil: null } as const;
    expect(await as((tx) => saveDocument(tx, desk, zoe, { ...base, receivedOn: "2026-10-30" }, TODAY))).toEqual({
      ok: false,
      message: "La date de réception ne peut pas être dans le futur.",
    });
    expect(
      await as((tx) =>
        saveDocument(tx, desk, zoe, { ...base, receivedOn: "2026-10-01", validUntil: "2026-09-01" }, TODAY),
      ),
    ).toEqual({ ok: false, message: "La fin de validité doit suivre la date du document." });
    expect(
      await as((tx) =>
        saveDocument(tx, desk, zoe, { ...base, receivedOn: "2026-10-01", datedOn: "2026-10-02" }, TODAY),
      ),
    ).toEqual({ ok: false, message: "Le document ne peut pas être daté après sa réception." });
  });

  it("removes a document entered by mistake; the audit log keeps it", async () => {
    await as((tx) => receiveToday(tx, desk, noe, "image_rights", TODAY));
    const [doc] = await as((tx) => studentDocuments(tx, noe));
    expect(await as((tx) => removeDocument(tx, desk, noe, "image_rights"))).toEqual({ ok: true });
    expect(await as((tx) => studentDocuments(tx, noe))).toEqual([]);
    const log = await auditOf(doc.id);
    expect(log.at(-1)).toMatchObject({ action: "delete", after: null });
    expect(log.at(-1)?.before).toMatchObject({ type: "image_rights", receivedOn: TODAY });
  });

  it("never reaches another school's student", async () => {
    expect(await as((tx) => receiveToday(tx, desk, foreign, "image_rights", TODAY))).toEqual({
      ok: false,
      message: "Cet élève n’existe plus.",
    });
    expect(await as((tx) => studentDocuments(tx, foreign))).toEqual([]);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM student_document WHERE student_id = ${foreign}`;
    expect(n).toBe(0);
  });

  it("refuses a second row for the same student and type, whatever writes it", async () => {
    await expect(
      admin`INSERT INTO student_document (school_id, student_id, type) VALUES (${school}, ${zoe}, 'medical_certificate')`,
    ).rejects.toThrow(/student_document_student_id_type_unique/);
  });
});

describe("« Documents manquants » on the students list", () => {
  it("lists the documents overdue for the season's enrolled students only", async () => {
    // Zoé handed in her certificate. Alex has until 2026-11-04. Noé is on the waiting list: nothing is chased yet.
    expect(await missingColumn()).toEqual({ Zoé: [], Alex: [], Noé: [] });
    // The day after Alex's due date, the certificate is overdue.
    expect(await missingColumn("2026-11-05")).toEqual({ Zoé: [], Alex: ["Certificat médical"], Noé: [] });
  });

  it("matches the domain rule, expiry included", async () => {
    // Expired yesterday: the same 15 days to renew it, not late yet.
    await admin`UPDATE student_document SET valid_until = '2026-10-28' WHERE student_id = ${zoe} AND type = 'medical_certificate'`;
    expect((await missingColumn()).Zoé).toEqual([]);
    // Expired on 2026-10-01: due by 2026-10-17, late today.
    await admin`UPDATE student_document SET valid_until = '2026-10-01' WHERE student_id = ${zoe} AND type = 'medical_certificate'`;
    const requirements = await as((tx) => readRequirements(tx));
    const documents = await as((tx) => studentDocuments(tx, zoe));
    const enrolledOn = await as((tx) => firstEnrollmentDate(tx, zoe, season));
    expect(enrolledOn).toBe("2026-09-05");
    const domain = missingDocuments({ requirements, documents, birthDate: "2015-03-10", enrolledOn, today: TODAY });
    expect(domain).toEqual(["medical_certificate"]);
    expect((await missingColumn()).Zoé).toEqual(["Certificat médical"]);
    expect(await as((tx) => firstEnrollmentDate(tx, noe, season))).toBeNull();
  });

  it("filters by checkbox, « aucun » included, and follows the school's setting", async () => {
    const requirements = await as((tx) => readRequirements(tx));
    const among = (value: string, reqs = requirements) =>
      as((tx) =>
        listStudents(tx, "", {
          today: TODAY,
          seasonId: season,
          requirements: reqs,
          filter: { mode: "et", conditions: [{ column: "documents", operator: "parmi", value }] },
        }),
      );
    expect((await among("Certificat médical")).map((r) => r.firstName)).toEqual(["Zoé"]);
    expect((await among("(vide)")).map((r) => r.firstName).sort()).toEqual(["Alex", "Noé"]);

    // Parental consent asked of minors within 30 days: Zoé (minor, enrolled since 2026-09-05) is late.
    const consent = requirements.map((r) =>
      r.type === "parental_consent" ? { ...r, required: true, dueWithinDays: 30 } : r,
    );
    expect((await among("Autorisation parentale", consent)).map((r) => r.firstName)).toEqual(["Zoé"]);

    const none = requirements.map((r) => ({ ...r, required: false }));
    const rows = await as((tx) => listStudents(tx, "", { today: TODAY, seasonId: season, requirements: none }));
    expect(rows.every((r) => r.missingDocuments.length === 0)).toBe(true);
  });
});
