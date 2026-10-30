/**
 * Payment methods (#293): the list the software knows, and the ones each school
 * accepts. Which methods a school takes is a school setting (`payment_method_setting`),
 * never code: the payment form offers only those, and a payment by another one is
 * refused. Payments already recorded keep their method, accepted or not: they are
 * immutable and still show and export with their label.
 *
 * Default, from the founding school's answer on #293 (question 1, card « certainement
 * à la rentrée »): a school that never chose accepts every method, card included,
 * each one can be switched off. It lives in `DEFAULT_METHOD_SETTING` below, and
 * nowhere else. A partial transfer stays allowed (question 2): the school may write
 * a hint shown at the desk next to the method (« Virement : règlement de la totalité »).
 */

/** Methods, in the order of the `payment_method` database enum and of the screens. */
export const PAYMENT_METHOD_VALUES = [
  "cheque",
  "cash",
  "card",
  "transfer",
  "direct_debit",
  "holiday_voucher",
  // Electronic holiday vouchers (ANCV Connect): paid online by the operator, never deposited.
  "holiday_voucher_online",
  "pass_sport",
  "other",
] as const;
export type Method = (typeof PAYMENT_METHOD_VALUES)[number];

/** Names shown to the user: forms, records, payment log, exports. */
export const METHOD_LABELS: Record<Method, string> = {
  cheque: "Chèque",
  cash: "Espèces",
  card: "Carte",
  transfer: "Virement",
  direct_debit: "Prélèvement",
  holiday_voucher: "Chèques vacances (papier)",
  holiday_voucher_online: "ANCV Connect",
  pass_sport: "Pass’Sport",
  other: "Autre",
};

/** Longest hint shown at the desk next to a method. */
export const DESK_HINT_MAX = 120;

/** What a school says of one method: accepted or not, and an optional hint for the desk. */
export type MethodSetting = { method: Method; accepted: boolean; deskHint: string | null };

/** A method the school never set: accepted, without a hint (#293, default 1). */
export const DEFAULT_METHOD_SETTING = { accepted: true, deskHint: null } as const;

/** Every method with what the school saved for it, or the default; in `PAYMENT_METHOD_VALUES` order. */
export function effectiveMethodSettings(saved: readonly MethodSetting[]): MethodSetting[] {
  return PAYMENT_METHOD_VALUES.map(
    (method) => saved.find((s) => s.method === method) ?? { method, ...DEFAULT_METHOD_SETTING },
  );
}

/** Methods the payment form offers: the accepted ones, in order. */
export function offeredMethods(settings: readonly MethodSetting[]): Method[] {
  return settings.filter((s) => s.accepted).map((s) => s.method);
}

/** The first of `methods` the school does not accept, or null when all are accepted. */
export function refusedMethod(methods: readonly Method[], settings: readonly MethodSetting[]): Method | null {
  const offered = new Set(offeredMethods(settings));
  return methods.find((m) => !offered.has(m)) ?? null;
}

/** Why a set of settings cannot be saved, or null: every method once, at least one accepted. */
export function settingsRefusal(settings: readonly MethodSetting[]): string | null {
  const methods = new Set(settings.map((s) => s.method));
  if (methods.size !== settings.length || PAYMENT_METHOD_VALUES.some((m) => !methods.has(m)))
    return "Saisie invalide : rechargez la page.";
  if (!settings.some((s) => s.accepted)) return "Cochez au moins un moyen de paiement.";
  return null;
}
