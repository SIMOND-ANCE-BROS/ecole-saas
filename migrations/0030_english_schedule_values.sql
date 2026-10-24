-- English values for the schedule and instructor enums (#114): only the
-- labels change; rows and column defaults follow (enum constants are stored
-- by reference). `competition`, `dates`, `google`, `microsoft` and
-- `franchise_293b` already read the same in English.
ALTER TYPE "course_type" RENAME VALUE 'collectif' TO 'group';--> statement-breakpoint
ALTER TYPE "course_type" RENAME VALUE 'particulier' TO 'private';--> statement-breakpoint
ALTER TYPE "course_type" RENAME VALUE 'stage' TO 'workshop';--> statement-breakpoint
ALTER TYPE "course_recurrence" RENAME VALUE 'hebdomadaire' TO 'weekly';--> statement-breakpoint
ALTER TYPE "course_recurrence" RENAME VALUE 'quinzaine' TO 'biweekly';--> statement-breakpoint
ALTER TYPE "lesson_status" RENAME VALUE 'prevue' TO 'planned';--> statement-breakpoint
ALTER TYPE "lesson_status" RENAME VALUE 'effectuee' TO 'done';--> statement-breakpoint
ALTER TYPE "lesson_status" RENAME VALUE 'annulee' TO 'cancelled';--> statement-breakpoint
ALTER TYPE "unavailability_source" RENAME VALUE 'saisie' TO 'manual';--> statement-breakpoint
ALTER TYPE "instructor_status" RENAME VALUE 'micro_entreprise' TO 'sole_trader';--> statement-breakpoint
ALTER TYPE "instructor_status" RENAME VALUE 'societe' TO 'company';--> statement-breakpoint
ALTER TYPE "instructor_status" RENAME VALUE 'salarie' TO 'employee';--> statement-breakpoint
ALTER TYPE "pay_mode" RENAME VALUE 'heure' TO 'hourly';--> statement-breakpoint
ALTER TYPE "pay_mode" RENAME VALUE 'cours' TO 'per_lesson';--> statement-breakpoint
ALTER TYPE "pay_mode" RENAME VALUE 'forfait_mensuel' TO 'monthly_flat';--> statement-breakpoint
ALTER TYPE "vat_regime" RENAME VALUE 'assujetti' TO 'vat_registered';--> statement-breakpoint
ALTER TYPE "vat_regime" RENAME VALUE 'non_applicable' TO 'not_applicable';
