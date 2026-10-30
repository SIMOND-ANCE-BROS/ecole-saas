-- Season quarters (#291): the periods a quarterly package is sold and cashed by, as data of
-- each season, and the quarters each quarterly enrollment covers.
CREATE TABLE "enrollment_quarter" (
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"quarter_id" uuid NOT NULL,
	CONSTRAINT "enrollment_quarter_enrollment_id_quarter_id_pk" PRIMARY KEY("enrollment_id","quarter_id")
);
--> statement-breakpoint
CREATE TABLE "season_quarter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "season_quarter_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "season_quarter_dates" CHECK ("season_quarter"."end_date" >= "season_quarter"."start_date"),
	CONSTRAINT "season_quarter_label" CHECK (btrim("season_quarter"."label") <> '')
);
--> statement-breakpoint
ALTER TABLE "enrollment_quarter" ADD CONSTRAINT "enrollment_quarter_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_quarter" ADD CONSTRAINT "enrollment_quarter_enrollment_same_school_fk" FOREIGN KEY ("school_id","enrollment_id") REFERENCES "public"."enrollment"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_quarter" ADD CONSTRAINT "enrollment_quarter_quarter_same_school_fk" FOREIGN KEY ("school_id","quarter_id") REFERENCES "public"."season_quarter"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_quarter" ADD CONSTRAINT "season_quarter_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_quarter" ADD CONSTRAINT "season_quarter_season_same_school_fk" FOREIGN KEY ("school_id","season_id") REFERENCES "public"."season"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_quarter_quarter_id_index" ON "enrollment_quarter" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "season_quarter_season_id_start_date_index" ON "season_quarter" USING btree ("season_id","start_date");--> statement-breakpoint
ALTER TABLE season_quarter ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE season_quarter FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON season_quarter
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE enrollment_quarter ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE enrollment_quarter FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON enrollment_quarter
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Every existing season gets the default quarters, as `defaultQuarters` computes them
-- (src/domain/enrollment/quarters.ts): three periods of three months ending with the season,
-- each starting on the first day of a month, clipped to the season's start, the ones wholly
-- before it left out, labelled « 1er trimestre », « 2e trimestre »… in date order.
INSERT INTO season_quarter (school_id, season_id, label, start_date, end_date)
SELECT q.school_id, q.season_id,
  CASE WHEN q.rank = 1 THEN '1er trimestre' ELSE q.rank || 'e trimestre' END,
  q.start_date, q.end_date
FROM (
  SELECT d.*, row_number() OVER (PARTITION BY d.season_id ORDER BY d.start_date) AS rank
  FROM (
    SELECT s.school_id, s.id AS season_id,
      greatest((date_trunc('month', s.end_date) - make_interval(months => k * 3 + 2))::date, s.start_date) AS start_date,
      CASE WHEN k = 0 THEN s.end_date
        ELSE (date_trunc('month', s.end_date) - make_interval(months => k * 3 - 1) - interval '1 day')::date END AS end_date
    FROM season s CROSS JOIN generate_series(0, 2) AS k
  ) d
  WHERE d.end_date >= (SELECT start_date FROM season WHERE id = d.season_id)
) q;--> statement-breakpoint
-- Every existing quarterly enrollment covers the quarters not over on its enrollment day
-- (`coveredQuarters`, #291 Q1 default: a quarter already started counts in full); one
-- enrolled after the last quarter ended keeps the last one, so it stays owed once as before.
INSERT INTO enrollment_quarter (school_id, enrollment_id, quarter_id)
SELECT e.school_id, e.id, q.id
FROM enrollment e
JOIN season_quarter q ON q.season_id = e.season_id
WHERE e.period = 'quarter'
  AND (
    q.end_date >= e.enrolled_on
    OR (
      NOT EXISTS (SELECT 1 FROM season_quarter r WHERE r.season_id = e.season_id AND r.end_date >= e.enrolled_on)
      AND q.start_date = (SELECT max(r.start_date) FROM season_quarter r WHERE r.season_id = e.season_id)
    )
  );
