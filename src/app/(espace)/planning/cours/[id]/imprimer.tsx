"use client";

export function PrintButton() {
  return (
    <button type="button" className="bouton-secondaire" onClick={() => window.print()}>
      Imprimer la liste
    </button>
  );
}
