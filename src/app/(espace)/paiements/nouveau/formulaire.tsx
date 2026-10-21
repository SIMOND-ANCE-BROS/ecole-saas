"use client";

import { useState, useTransition } from "react";
import { Annuler } from "@/app/(espace)/_panneau/panneau";
import { MOYENS, type Moyen } from "@/db/paiements";
import { formaterEuros, lireEuros } from "@/lib/montant";
import { encaisserReglements } from "../actions";

type Ligne = { moyen: Moyen; montant: string; reference: string; emetteur: string; encaissement: string };
const LIGNE_VIDE: Ligne = { moyen: "cheque", montant: "", reference: "", emetteur: "", encaissement: "" };

type Props = { payeurId: string; payeur: string; reste: number | null; aujourdhui: string; retour: string };

/**
 * Encaissement d'un payeur (#97) : une ligne par règlement (trois chèques
 * datés, un chèque et des espèces…), date de réception commune, total
 * comparé au reste à payer.
 */
export function FormulaireEncaissement({ payeurId, payeur, reste, aujourdhui, retour }: Props) {
  const [lignes, setLignes] = useState<Ligne[]>([{ ...LIGNE_VIDE, montant: reste && reste > 0 ? (reste / 100).toFixed(2).replace(".", ",") : "" }]);
  const [date, setDate] = useState(aujourdhui);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  const maj = (i: number, v: Partial<Ligne>) => setLignes(lignes.map((l, j) => (j === i ? { ...l, ...v } : l)));
  const montants = lignes.map((l) => lireEuros(l.montant));
  const total = montants.reduce<number>((s, m) => s + (m ?? 0), 0);
  const invalides = lignes.map((l, i) => l.montant.trim() !== "" && (montants[i] === null || montants[i] === 0));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (montants.some((m) => !m)) {
          setMessage("Indiquez un montant pour chaque règlement.");
          return;
        }
        const saisie = lignes.map((l, i) => ({
          moyen: l.moyen,
          montantCentimes: montants[i],
          date,
          reference: l.reference,
          emetteur: l.emetteur,
          encaissementPrevu: l.moyen === "cheque" && l.encaissement ? l.encaissement : null,
        }));
        setMessage(null);
        demarrer(async () => setMessage((await encaisserReglements(payeurId, saisie, retour)).message));
      }}
    >
      <p className="text-sm">
        Payeur : <strong>{payeur}</strong>
        {reste !== null && (
          <span className="text-doux"> — {reste > 0 ? `reste à payer ${formaterEuros(reste)}` : reste < 0 ? `trop-perçu ${formaterEuros(-reste)}` : "à jour"}</span>
        )}
      </p>
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label htmlFor="date-reception" className="text-sm font-medium">
          Reçu le
        </label>
        <input id="date-reception" type="date" className="champ" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Règlements</legend>
        {lignes.map((l, i) => (
          <div key={i} className="panneau grid gap-2 p-3 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1">
              <label htmlFor={`moyen-${i}`} className="text-xs text-doux">
                Moyen
              </label>
              <select id={`moyen-${i}`} className="champ" value={l.moyen} onChange={(e) => maj(i, { moyen: e.target.value as Moyen })}>
                {Object.entries(MOYENS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`montant-${i}`} className="text-xs text-doux">
                Montant (€)
              </label>
              <input
                id={`montant-${i}`}
                inputMode="decimal"
                className="champ text-right tabular-nums"
                value={l.montant}
                onChange={(e) => maj(i, { montant: e.target.value })}
                aria-invalid={invalides[i] || undefined}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`reference-${i}`} className="text-xs text-doux">
                {l.moyen === "cheque" ? "N° de chèque" : "Référence (facultatif)"}
              </label>
              <input id={`reference-${i}`} className="champ" value={l.reference} onChange={(e) => maj(i, { reference: e.target.value })} />
            </div>
            {lignes.length > 1 ? (
              <button type="button" className="bouton-secondaire px-2" aria-label={`Retirer le règlement ${i + 1}`} onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>
                ×
              </button>
            ) : (
              <span />
            )}
            {l.moyen === "cheque" && (
              <>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor={`emetteur-${i}`} className="text-xs text-doux">
                    Banque ou titulaire (facultatif)
                  </label>
                  <input id={`emetteur-${i}`} className="champ" value={l.emetteur} onChange={(e) => maj(i, { emetteur: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor={`encaissement-${i}`} className="text-xs text-doux">
                    À encaisser le (vide : tout de suite)
                  </label>
                  <input id={`encaissement-${i}`} type="date" min={date} className="champ" value={l.encaissement} onChange={(e) => maj(i, { encaissement: e.target.value })} />
                </div>
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          className="lien self-start text-sm"
          disabled={lignes.length >= 24}
          onClick={() => setLignes([...lignes, { ...LIGNE_VIDE, moyen: lignes.at(-1)?.moyen ?? "cheque", emetteur: lignes.at(-1)?.emetteur ?? "" }])}
        >
          Ajouter un règlement
        </button>
      </fieldset>

      <p className="text-sm" aria-live="polite">
        Total : <strong className="tabular-nums">{formaterEuros(total)}</strong>
        {reste !== null && reste > 0 && total !== reste && <span className="text-doux"> (reste à payer : {formaterEuros(reste)})</span>}
      </p>
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={envoi || total === 0}>
          {envoi ? "Enregistrement…" : `Encaisser ${formaterEuros(total)}`}
        </button>
        <Annuler href={retour} />
      </div>
    </form>
  );
}
