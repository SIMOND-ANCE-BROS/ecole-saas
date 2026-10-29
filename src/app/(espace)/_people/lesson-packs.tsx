import { Accordion, AccordionControl, AccordionItem, AccordionPanel, Paper, Text, Title } from "@mantine/core";
import type { PackRow } from "@/db/lesson-packs";
import { isOpen, packLabel } from "@/domain/lesson-pack/pack";
import { formatEuros } from "@/lib/money";
import { TextLink } from "../_ui/text-link";
import { dayOf } from "./sections";

const HEADING = "carnets";

/** One pack: what remains, who it is for, who pays, its price. */
function PackLine({ pack, personId }: { pack: PackRow; personId: string }) {
  const names = pack.participants.map((p) => p.name);
  const guests = pack.peopleCount - names.length;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <Text span size="sm" fw={500}>
          {packLabel(pack)}
        </Text>
        <Text span size="xs" c="dimmed">
          Pour {names.join(", ")}
          {guests > 0 && ` et ${guests} invité${guests > 1 ? "s" : ""}`}
          {pack.payerId !== personId && (
            <>
              {" · Facturé à "}
              <TextLink href={`/personnes/${pack.payerId}`} size="xs" inherit>
                {pack.payer}
              </TextLink>
            </>
          )}
          {` · vendu le ${dayOf(pack.purchasedOn)}`}
        </Text>
      </span>
      <Text span size="sm" className="tabular-nums">
        {formatEuros(pack.priceCents)}
      </Text>
    </li>
  );
}

/**
 * Private-lesson packs of a record (#286): the ones the person pays for or is named
 * on. Open packs first with their remaining lessons; used-up ones folded away.
 * `sellHref`: where « Vendre un carnet » leads, null when no payer is known yet.
 */
export function LessonPacks({
  packs,
  personId,
  sellHref,
  noPayer = false,
}: {
  packs: PackRow[];
  personId: string;
  sellHref: string | null;
  /** A student without « Facturé à »: says how to be able to sell one. */
  noPayer?: boolean;
}) {
  const open = packs.filter(isOpen);
  const usedUp = packs.filter((p) => !isOpen(p));
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Title order={2} size="h5" id={HEADING}>
          Carnets de cours particuliers
        </Title>
        {sellHref && (
          <TextLink href={sellHref} size="sm">
            Vendre un carnet
          </TextLink>
        )}
      </div>
      {open.length === 0 ? (
        <Text size="sm" c="dimmed">
          {usedUp.length === 0 ? "Aucun carnet." : "Aucun carnet en cours."}
          {noPayer && " Choisissez d’abord «\u00a0Facturé à\u00a0» pour vendre un carnet."}
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure">
          {open.map((p) => (
            <PackLine key={p.id} pack={p} personId={personId} />
          ))}
        </Paper>
      )}
      {usedUp.length > 0 && (
        <Accordion variant="contained" chevronPosition="left">
          <AccordionItem value="epuises">
            <AccordionControl>
              <Text span size="sm">
                Carnets épuisés ({usedUp.length})
              </Text>
            </AccordionControl>
            <AccordionPanel>
              <ul className="-mx-3 divide-y divide-bordure">
                {usedUp.map((p) => (
                  <PackLine key={p.id} pack={p} personId={personId} />
                ))}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </section>
  );
}
