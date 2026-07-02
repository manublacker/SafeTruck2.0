// Reconciliación de listas para vistas que revalidan datos (stale-while-revalidate,
// polling, refetch al remontar). En vez de reemplazar la lista entera con la que
// llega del server, mezcla ambas por `id`: conserva la referencia de los items
// que no cambiaron —para no re-renderizar filas intactas— e inserta/actualiza
// sólo los distintos. Si nada cambió (ni contenido ni orden) devuelve el MISMO
// array previo, así el `setState` correspondiente no dispara un re-render.
export function reconcileById<T extends { id: number | string }>(
  prev: T[],
  incoming: T[],
  isEqual: (a: T, b: T) => boolean,
): T[] {
  const prevById = new Map(prev.map((it) => [it.id, it]));
  const merged = incoming.map((next) => {
    const old = prevById.get(next.id);
    return old && isEqual(old, next) ? old : next;
  });
  const unchanged =
    merged.length === prev.length && merged.every((it, i) => it === prev[i]);
  return unchanged ? prev : merged;
}
