import { MESSAGES, type MessageId, t } from "../core/messages";

/** Returns the element with the given ID, throwing if it does not exist. */
export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element #${id} not found.`);
  }
  return el as T;
}

/**
 * Puts the current locale's messages into the page: data-i18n sets the text,
 * data-i18n-label the aria-label and data-i18n-title the tooltip. The page's
 * own English stays where an ID is missing.
 */
export function localize(root: ParentNode) {
  const attrs = [["i18n", null], ["i18nLabel", "aria-label"], ["i18nTitle", "title"]] as const;
  for (const [key, attr] of attrs) {
    const selector = `[data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const id = el.dataset[key] as MessageId;
      if (!(id in MESSAGES.en)) return;
      if (attr) {
        el.setAttribute(attr, t(id));
      } else {
        el.textContent = t(id);
      }
    });
  }
}
