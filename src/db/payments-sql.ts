import { sql } from "drizzle-orm";
import { payment } from "./schema";

/**
 * Amount already cancelled by reverse entries, in the direction that cancels: the corrections
 * and rejection of a payment (negative entries under a positive payment), or the cancellations
 * of a refund (positive entries under a negative refund, #346). Positive in both cases; an
 * entry of the wrong sign under a payment would lower it instead of hiding (the database does
 * not check what a reverse entry targets, the code does). Identifiers written with the table
 * name: in a `select`, Drizzle would write them alone, and they would then refer to the
 * subquery's row. Apart from `payments.ts` so that the allocations (#305) read it too.
 */
export const alreadyCorrected = sql<number>`coalesce((SELECT sign(-${payment}.${sql.identifier("amount_cents")}) * sum(c.amount_cents) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;
