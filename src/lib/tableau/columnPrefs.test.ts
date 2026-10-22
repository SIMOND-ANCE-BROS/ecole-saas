import { describe, expect, it } from "vitest";
import {
  type ColumnPrefs,
  DEFAULT_COLUMN_PREFS,
  depuisEnregistrement,
  dropKey,
  isColumnVisible,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveKey,
  orderColumns,
  versEnregistrement,
} from './columnPrefs';

const prefs = (patch: Partial<ColumnPrefs>): ColumnPrefs => ({ ...DEFAULT_COLUMN_PREFS, ...patch });

describe('column preferences', () => {
  const COLUMNS = [{ key: 'name', required: true }, { key: 'email' }, { key: 'login', hiddenByDefault: true }];

  it('lit l’enregistrement du membre : visibilité, largeurs bornées, ordre', () => {
    expect(depuisEnregistrement(['email@180', '-name', 'login@20', 'inconnue', 'email'], COLUMNS)).toEqual({
      visible: { login: true },
      widths: { email: 180, login: MIN_COLUMN_WIDTH },
      order: ['email', 'name', 'login'],
    });
    expect(depuisEnregistrement(['name', 'email@99999', '-login'], COLUMNS)).toEqual(prefs({ widths: { email: MAX_COLUMN_WIDTH } }));
    expect(depuisEnregistrement(null, COLUMNS)).toEqual(DEFAULT_COLUMN_PREFS);
  });

  it('écrit toutes les colonnes dans l’ordre affiché, et se relit à l’identique', () => {
    const p = prefs({ visible: { email: false, login: true }, widths: { login: 240 }, order: ['login', 'name', 'email'] });
    const enregistree = versEnregistrement(p, COLUMNS);
    expect(enregistree).toEqual(['login@240', 'name', '-email']);
    expect(depuisEnregistrement(enregistree, COLUMNS)).toEqual(p);
    expect(versEnregistrement(DEFAULT_COLUMN_PREFS, COLUMNS)).toEqual(['name', 'email', '-login']);
  });

  it('shows a column by its default unless the admin chose otherwise; never hides a required one', () => {
    expect(isColumnVisible({ key: 'email' }, prefs({}))).toBe(true);
    expect(isColumnVisible({ key: 'email' }, prefs({ visible: { email: false } }))).toBe(false);
    expect(isColumnVisible({ key: 'login', hiddenByDefault: true }, prefs({}))).toBe(false);
    expect(
      isColumnVisible({ key: 'login', hiddenByDefault: true }, prefs({ visible: { login: true } })),
    ).toBe(true);
    expect(
      isColumnVisible({ key: 'name', required: true }, prefs({ visible: { name: false } })),
    ).toBe(true);
  });
});

describe('column order (#671)', () => {
  const columns = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
  const keys = (list: { key: string }[]) => list.map((c) => c.key);

  it('follows the stored order, keeps a new column at its default place, ignores a removed one', () => {
    expect(keys(orderColumns(columns, []))).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(orderColumns(columns, ['d', 'c', 'b', 'a']))).toEqual(['d', 'c', 'b', 'a']);
    expect(keys(orderColumns(columns, ['c', 'gone', 'a']))).toEqual(['c', 'b', 'a', 'd']);
  });

  it('moves a key up or down, clamped to the ends', () => {
    expect(moveKey(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });

  it('drops a key before or after another', () => {
    expect(dropKey(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(dropKey(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(dropKey(['a', 'b', 'c'], 'a', 'a', 'after')).toEqual(['a', 'b', 'c']);
    expect(dropKey(['a', 'b', 'c'], 'x', 'a', 'after')).toEqual(['a', 'b', 'c']);
  });
});
