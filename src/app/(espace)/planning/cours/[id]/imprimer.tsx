"use client";

export function BoutonImprimer() {
  return (
    <button type="button" className="bouton-secondaire" onClick={() => window.print()}>
      Imprimer la liste
    </button>
  );
}
