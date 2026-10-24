-- English values for the billing, payment and tariff enums (#114): only the
-- labels change; rows, defaults, the invitation check, the open-installments
-- partial index and discount.audiences (an enum array) follow, since enum
-- constants are stored by reference. Values already in English (cheque,
-- pass_sport, active, couple, invitation, pennylane…) are unchanged.
ALTER TYPE "payment_method" RENAME VALUE 'especes' TO 'cash';--> statement-breakpoint
ALTER TYPE "payment_method" RENAME VALUE 'carte' TO 'card';--> statement-breakpoint
ALTER TYPE "payment_method" RENAME VALUE 'virement' TO 'transfer';--> statement-breakpoint
ALTER TYPE "payment_method" RENAME VALUE 'prelevement' TO 'direct_debit';--> statement-breakpoint
ALTER TYPE "payment_method" RENAME VALUE 'cheque_vacances' TO 'holiday_voucher';--> statement-breakpoint
ALTER TYPE "payment_method" RENAME VALUE 'autre' TO 'other';--> statement-breakpoint
ALTER TYPE "deposit_method" RENAME VALUE 'especes' TO 'cash';--> statement-breakpoint
ALTER TYPE "deposit_method" RENAME VALUE 'cheque_vacances' TO 'holiday_voucher';--> statement-breakpoint
ALTER TYPE "enrollment_status" RENAME VALUE 'essai' TO 'trial';--> statement-breakpoint
ALTER TYPE "enrollment_status" RENAME VALUE 'liste_attente' TO 'waitlist';--> statement-breakpoint
ALTER TYPE "enrollment_status" RENAME VALUE 'abandon' TO 'dropped';--> statement-breakpoint
ALTER TYPE "enrollment_status" RENAME VALUE 'terminee' TO 'ended';--> statement-breakpoint
ALTER TYPE "installment_status" RENAME VALUE 'a_venir' TO 'upcoming';--> statement-breakpoint
ALTER TYPE "installment_status" RENAME VALUE 'payee' TO 'paid';--> statement-breakpoint
ALTER TYPE "installment_status" RENAME VALUE 'partielle' TO 'partial';--> statement-breakpoint
ALTER TYPE "installment_status" RENAME VALUE 'en_retard' TO 'overdue';--> statement-breakpoint
ALTER TYPE "installment_status" RENAME VALUE 'annulee' TO 'cancelled';--> statement-breakpoint
ALTER TYPE "invoice_status" RENAME VALUE 'a_envoyer' TO 'to_send';--> statement-breakpoint
ALTER TYPE "invoice_status" RENAME VALUE 'brouillon_outil' TO 'tool_draft';--> statement-breakpoint
ALTER TYPE "invoice_status" RENAME VALUE 'emise' TO 'issued';--> statement-breakpoint
ALTER TYPE "invoice_status" RENAME VALUE 'rejetee' TO 'rejected';--> statement-breakpoint
ALTER TYPE "invoice_status" RENAME VALUE 'annulee' TO 'cancelled';--> statement-breakpoint
ALTER TYPE "statement_status" RENAME VALUE 'a_controler' TO 'to_check';--> statement-breakpoint
ALTER TYPE "statement_status" RENAME VALUE 'conforme' TO 'matching';--> statement-breakpoint
ALTER TYPE "statement_status" RENAME VALUE 'ecart' TO 'discrepancy';--> statement-breakpoint
ALTER TYPE "statement_status" RENAME VALUE 'paye' TO 'paid';--> statement-breakpoint
ALTER TYPE "invitation_type" RENAME VALUE 'reinitialisation' TO 'reset';--> statement-breakpoint
ALTER TYPE "period" RENAME VALUE 'trimestre' TO 'quarter';--> statement-breakpoint
ALTER TYPE "period" RENAME VALUE 'annee' TO 'year';--> statement-breakpoint
ALTER TYPE "period" RENAME VALUE 'unite' TO 'single';--> statement-breakpoint
ALTER TYPE "tariff_audience" RENAME VALUE 'enfant' TO 'child';--> statement-breakpoint
ALTER TYPE "tariff_audience" RENAME VALUE 'adulte' TO 'adult';--> statement-breakpoint
ALTER TYPE "tariff_audience" RENAME VALUE 'etudiant' TO 'student';
