import { es } from './es';

export const defaultLocale = 'es' as const;
export type UiLocale = 'es' | 'en' | 'de';
type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? LeafPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];
export type TranslationKey = LeafPaths<typeof es>;
const catalogs: Partial<Record<UiLocale, typeof es>> = { es };

export function translate(key: TranslationKey, locale: UiLocale = defaultLocale): string {
  const catalog = catalogs[locale] ?? es;
  const read = (source: object) =>
    key
      .split('.')
      .reduce<unknown>(
        (value, part) =>
          typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)[part]
            : undefined,
        source,
      );
  const localized = read(catalog);
  const fallback = read(es);
  return typeof localized === 'string' ? localized : typeof fallback === 'string' ? fallback : key;
}
