/**
 * Localized text. A field is either a plain string (used for every locale) or a
 * `{ locale: text }` map. Resolution: exact locale → its language prefix →
 * each fallback in order → the first value present. Never throws, never
 * returns undefined for a non-empty map: a roadmap must render in every
 * locale a site asks for, even when a translation lags.
 */

import type { LocalizedString } from "./types";

export function resolveText(
  value: LocalizedString | undefined,
  locale: string,
  fallbacks: readonly string[] = []
): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const direct = value[locale];
  if (direct) return direct;
  const lang = locale.split("-")[0];
  if (lang && value[lang]) return value[lang];
  for (const fb of fallbacks) {
    if (value[fb]) return value[fb];
  }
  const first = Object.values(value)[0];
  return first ?? "";
}

/** Locales a text is available in. Plain strings are available everywhere. */
export function localesOf(value: LocalizedString | undefined): string[] | "all" {
  if (value === undefined) return [];
  if (typeof value === "string") return "all";
  return Object.keys(value);
}

/** True when `value` has no text for `locale` and would fall back. */
export function missingLocale(value: LocalizedString | undefined, locale: string): boolean {
  if (value === undefined || typeof value === "string") return false;
  if (value[locale]) return false;
  const lang = locale.split("-")[0];
  return !(lang && value[lang]);
}
