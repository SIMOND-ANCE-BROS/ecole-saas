import { afterEach, describe, expect, it, vi } from "vitest";
import { requeteDifferee } from "./requete-differee";

afterEach(() => vi.useRealTimers());
const promesse = <T>() => {
  let resoudre!: (valeur: T) => void;
  let rejeter!: (erreur: Error) => void;
  const attente = new Promise<T>((resolve, reject) => {
    resoudre = resolve;
    rejeter = reject;
  });
  return { attente, resoudre, rejeter };
};

describe("aperçu différé lié à la saisie courante", () => {
  it("ne lance pas un calcul annulé pendant la frappe", async () => {
    vi.useFakeTimers();
    const charger = vi.fn(async () => 100);
    const annuler = requeteDifferee(charger, vi.fn(), vi.fn());
    annuler();
    await vi.runAllTimersAsync();
    expect(charger).not.toHaveBeenCalled();
  });

  it("ignore une ancienne réponse arrivée après le nouveau prix", async () => {
    vi.useFakeTimers();
    const ancien = promesse<number>();
    const nouveau = promesse<number>();
    const afficher = vi.fn();
    const annuler = requeteDifferee(() => ancien.attente, afficher, vi.fn());
    await vi.advanceTimersByTimeAsync(150);
    annuler();
    requeteDifferee(() => nouveau.attente, afficher, vi.fn());
    await vi.advanceTimersByTimeAsync(150);
    nouveau.resoudre(16500);
    await vi.runAllTimersAsync();
    ancien.resoudre(9500);
    await vi.runAllTimersAsync();
    expect(afficher.mock.calls).toEqual([[16500]]);
  });

  it("signale un échec pour proposer une nouvelle tentative", async () => {
    vi.useFakeTimers();
    const erreur = vi.fn();
    requeteDifferee(
      async () => {
        throw new Error("indisponible");
      },
      vi.fn(),
      erreur,
    );
    await vi.runAllTimersAsync();
    expect(erreur).toHaveBeenCalledOnce();
  });

  it("ignore un échec après changement de saisie ou départ de la page", async () => {
    vi.useFakeTimers();
    const ancienne = promesse<number>();
    const erreur = vi.fn();
    const annuler = requeteDifferee(() => ancienne.attente, vi.fn(), erreur);
    await vi.advanceTimersByTimeAsync(150);
    annuler();
    ancienne.rejeter(new Error("ancienne requête"));
    await vi.runAllTimersAsync();
    expect(erreur).not.toHaveBeenCalled();
  });
});
