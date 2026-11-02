import { Paper, Text, Title } from "@mantine/core";
import type { SignupRow } from "@/db/workshops";
import { formatEuros } from "@/lib/money";
import { TextLink } from "../_ui/text-link";
import { dayOf } from "./sections";
import { CancelSignup } from "./workshop-signup-cancel";

export const WORKSHOPS_HEADING = "stages";

/** One sign-up: the workshop and its dates, who takes part, who pays, what it owes. */
function SignupLine({ signup, personId }: { signup: SignupRow; personId: string }) {
  const count = signup.participants.length;
  const when = signup.dates.length > 0 ? signup.dates.map(dayOf).join(", ") : null;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <Text span size="sm" fw={500}>
          {signup.label}
          {when && ` — ${when}`}
        </Text>
        <Text span size="xs" c="dimmed">
          Pour {signup.participants.map((p) => p.name).join(", ")}
          {signup.payerId !== personId && (
            <>
              {" · Facturé à "}
              <TextLink href={`/personnes/${signup.payerId}`} size="xs" inherit className="inline-link">
                {signup.payer}
              </TextLink>
            </>
          )}
          {count > 1 && ` · ${count} × ${formatEuros(signup.unitPriceCents)}`}
        </Text>
      </span>
      <span className="flex items-baseline gap-3">
        <Text span size="sm" className="tabular-nums">
          {formatEuros(signup.dueCents)}
        </Text>
        <CancelSignup id={signup.id} summary={`${signup.label}, ${formatEuros(signup.dueCents)}`} />
      </span>
    </li>
  );
}

/**
 * Workshop sign-ups of a record (#297): the ones the person pays for or takes part in.
 * `signUpHref`: where « Inscrire à un stage » leads, null when no payer is known yet.
 */
export function WorkshopSignups({
  signups,
  personId,
  signUpHref,
}: {
  signups: SignupRow[];
  personId: string;
  signUpHref: string | null;
}) {
  return (
    <section aria-labelledby={WORKSHOPS_HEADING} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Title order={2} size="h5" id={WORKSHOPS_HEADING} tabIndex={-1}>
          Stages
        </Title>
        {signUpHref && (
          <TextLink href={signUpHref} size="sm">
            Inscrire à un stage
          </TextLink>
        )}
      </div>
      {signups.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun stage.
        </Text>
      ) : (
        <>
          <Paper withBorder component="ul" className="divide-y divide-bordure">
            {signups.map((s) => (
              <SignupLine key={s.id} signup={s} personId={personId} />
            ))}
          </Paper>
          {/* Billing a sign-up awaits the school's answers (#397). */}
          <Text size="xs" c="dimmed">
            Comptés dans le solde, pas encore sur les factures.
          </Text>
        </>
      )}
    </section>
  );
}
