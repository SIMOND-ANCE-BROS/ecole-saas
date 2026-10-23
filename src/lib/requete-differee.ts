/**
 * Attend la fin de la frappe et ignore les réponses périmées. La fonction
 * renvoyée annule le minuteur et la publication, pas la requête réseau lancée.
 */
export function deferredQuery<T>(
  load: () => Promise<T>,
  publish: (result: T) => void,
  reportError: () => void,
): () => void {
  let active = true;
  const timer = setTimeout(() => {
    load().then(
      (result) => {
        if (active) publish(result);
      },
      () => {
        if (active) reportError();
      },
    );
  }, 150);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}
