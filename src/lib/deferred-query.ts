/**
 * Waits for typing to end and ignores stale responses. The returned function
 * cancels the timer and the publication, not the network request in flight.
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
