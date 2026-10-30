import { type InvoicingToolName, PAYMENT_E_REPORTING } from "../../domain/billing/invoicing";
import { decrypt } from "../../lib/encryption";
import { type InvoicingConnector, InvoicingError } from "./contract";
import { FAKE_CREDENTIALS, fakeStoreOf, fakeTool } from "./fake";
import { guarded } from "./guard";

/** A billing entity's `invoicing_connector` row, as read inside `withSchool()`. */
export type EntityConnectorConfig = {
  billingEntityId: string;
  tool: InvoicingToolName;
  /** `invoicing_connector.encrypted_credentials` (`src/lib/encryption.ts`). */
  encryptedCredentials: string;
};

export type ConnectorOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  pauseMs?: number;
  /**
   * Overrides `PAYMENT_E_REPORTING` (#303 Q1, off). Contract tests only: no
   * application code passes it while the question is open.
   */
  recordPayment?: boolean;
};

/** Whether the simulation tool may run here: never unless `INVOICING_FAKE_ALLOWED=1`. */
export const fakeAllowed = (env: Readonly<Record<string, string | undefined>> = process.env) =>
  env.INVOICING_FAKE_ALLOWED === "1";

/**
 * Whether `connectorFor` can build a connector of `tool` on this server, credentials aside: what
 * the payer's record says of a draft's sending (#352). Kept next to `connectorFor`: a real tool
 * becomes available here with its connector (#288).
 */
export function toolAvailable(
  tool: InvoicingToolName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  switch (tool) {
    case "fake":
      return fakeAllowed(env);
    case "pennylane":
    case "abby":
    case "shine":
      return false;
  }
}

/**
 * The connector of one billing entity (ADR 0007), built from that entity's own
 * decrypted credentials: two businesses of a school never share a tool account.
 * The decrypted credentials stay inside the tool's client, never returned nor
 * logged. Throws `InvoicingError("configuration")` for the fake tool where it is
 * not allowed or for unreadable credentials, `unsupported` for a tool whose
 * connector does not exist yet.
 */
export function connectorFor(config: EntityConnectorConfig, options: ConnectorOptions = {}): InvoicingConnector {
  const guard = {
    capabilities: { recordPayment: options.recordPayment ?? PAYMENT_E_REPORTING },
    timeoutMs: options.timeoutMs,
    pauseMs: options.pauseMs,
  };
  switch (config.tool) {
    case "fake": {
      if (!fakeAllowed(options.env)) throw new InvoicingError("configuration", "connectorFor", "fake_not_allowed");
      const credentials = FAKE_CREDENTIALS.safeParse(credentialsOf(config.encryptedCredentials));
      if (!credentials.success) throw new InvoicingError("configuration", "connectorFor", "credentials_shape");
      return guarded(fakeTool(fakeStoreOf(config.billingEntityId), credentials.data), guard);
    }
    case "pennylane":
    case "abby":
    case "shine":
      // Real tools come once the accountant has chosen (#288): one issue per tool.
      throw new InvoicingError("unsupported", "connectorFor", "tool_not_implemented");
  }
}

/** Decrypted JSON credentials; their content never reaches an error message. */
function credentialsOf(encrypted: string): unknown {
  // A server without its key is not a school with wrong credentials: say which.
  if (Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64").length !== 32) {
    throw new InvoicingError("configuration", "connectorFor", "encryption_key_missing");
  }
  try {
    return JSON.parse(decrypt(encrypted));
  } catch {
    throw new InvoicingError("configuration", "connectorFor", "credentials_unreadable");
  }
}
