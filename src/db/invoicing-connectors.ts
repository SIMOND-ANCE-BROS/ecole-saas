import { and, eq } from "drizzle-orm";
import type { Tx } from "./index";
import { invoicingConnector } from "./schema";

/**
 * Invoicing connectors of a school (#303, ADR 0007): one per billing entity.
 * Always within `withSchool()` (RLS).
 */

/**
 * Whether a business of the school sends its invoices to the simulation tool:
 * the interface then shows « Mode simulation ». Reads the tool only, never the
 * credentials.
 */
export async function inSimulation(tx: Tx): Promise<boolean> {
  const rows = await tx
    .select({ id: invoicingConnector.billingEntityId })
    .from(invoicingConnector)
    .where(and(eq(invoicingConnector.tool, "fake"), eq(invoicingConnector.active, true)))
    .limit(1);
  return rows.length > 0;
}
