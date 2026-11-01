import { sql } from "drizzle-orm";
import { payment } from "./schema";

/**
 * Amount already cancelled by reverse entries, in the direction that cancels: the corrections
 * and rejection of a payment (negative entries under a positive payment), or the cancellations
 * of a refund (positive entries under a negative refund, #346). Positive in both cases, never
 * more than the original's amount: the code checks what a reverse entry targets, and so does
 * the database for every row inserted since migration 0059 (checks `payment_sign`,
 * `payment_reversal_kind` and the trigger `payment_reverse_target`, #356). Identifiers written with the table name:
 * in a `select`, Drizzle would write them alone, and they would then refer to the subquery's
 * row. Apart from `payments.ts` so that the allocations (#305) read it too.
 */
export const alreadyCorrected = sql<number>`coalesce((SELECT sign(-${payment}.${sql.identifier("amount_cents")}) * sum(c.amount_cents) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;
