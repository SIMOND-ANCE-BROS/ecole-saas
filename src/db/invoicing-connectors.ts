import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "./index";
import { billingEntity, invoicingConnector } from "./schema";

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

/**
 * Names of the school's businesses whose active connector is the simulation tool, by name: on a
 * server that refuses it (production, #351), management is told their invoices are held.
 */
export async function simulatedEntities(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ name: billingEntity.name })
    .from(invoicingConnector)
    .innerJoin(
      billingEntity,
      and(
        eq(billingEntity.schoolId, invoicingConnector.schoolId),
        eq(billingEntity.id, invoicingConnector.billingEntityId),
      ),
    )
    .where(and(eq(invoicingConnector.tool, "fake"), eq(invoicingConnector.active, true)))
    .orderBy(asc(billingEntity.name));
  return rows.map((r) => r.name);
}
