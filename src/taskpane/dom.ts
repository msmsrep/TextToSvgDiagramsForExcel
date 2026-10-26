/** Returns the element with the given ID, throwing if it does not exist. */
export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element #${id} not found.`);
  }
  return el as T;
}
