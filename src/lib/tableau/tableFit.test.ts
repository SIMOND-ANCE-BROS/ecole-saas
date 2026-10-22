import { describe, expect, it } from "vitest";
import { EXPANDER_WIDTH, type FitColumn, fitColumns } from './tableFit';

const col = (key: string, extra: Partial<FitColumn> = {}): FitColumn => ({
  key,
  minWidth: 100,
  weight: 1,
  priority: 0,
  pinned: false,
  ...extra,
});

const sum = (widths: Record<string, string>, expander: string | null) =>
  Object.values(widths)
    .concat(expander ?? '0%')
    .reduce((total, w) => total + Number.parseFloat(w), 0);

describe('fitColumns', () => {
  it('keeps every column and splits by weight while unmeasured', () => {
    const fit = fitColumns([col('a', { weight: 3 }), col('b')], 0);
    expect(fit.shown).toEqual(['a', 'b']);
    expect(fit.hidden).toEqual([]);
    expect(fit.widths).toEqual({ a: '75%', b: '25%' });
    expect(fit.expanderWidth).toBeNull();
  });

  it('keeps every column when their minimums fit, sharing the spare width by weight', () => {
    // 1000 px: 300 px of minimums, 700 px spare split between a and b → 450 + 450 + 100.
    const fit = fitColumns([col('a'), col('b'), col('c', { weight: 0 })], 1000);
    expect(fit.shown).toEqual(['a', 'b', 'c']);
    expect(fit.hidden).toEqual([]);
    expect(fit.widths).toEqual({ a: '45%', b: '45%', c: '10%' });
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
  });

  it('moves the least important columns out first, keeping the original order', () => {
    const columns = [
      col('name', { pinned: true }),
      col('email', { priority: 1 }),
      col('role', { priority: 3 }),
      col('club', { priority: 2 }),
    ];
    // Room for 3 columns once the expander is served.
    const fit = fitColumns(columns, 300 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['name', 'email', 'club']);
    expect(fit.hidden).toEqual(['role']);
    expect(fit.expanderWidth).not.toBeNull();
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
  });

  it('skips a wide column to keep a narrower, less important one that still fits', () => {
    const columns = [
      col('name', { pinned: true }),
      col('detail', { priority: 1, minWidth: 400 }),
      col('date', { priority: 2 }),
    ];
    const fit = fitColumns(columns, 250 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['name', 'date']);
    expect(fit.hidden).toEqual(['detail']);
  });

  it('never moves a pinned column out, even past its priority', () => {
    const columns = [
      col('a', { priority: 0 }),
      col('b', { priority: 1 }),
      col('c', { priority: 9, pinned: true }),
    ];
    const fit = fitColumns(columns, 200 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['a', 'c']);
    expect(fit.hidden).toEqual(['b']);
  });

  it('keeps room for a fixed selection column (#558)', () => {
    // 300 px fit three columns, but not once 40 px go to the checkboxes.
    expect(fitColumns([col('a'), col('b'), col('c')], 300).hidden).toEqual([]);
    const fit = fitColumns([col('a'), col('b'), col('c')], 300, 40);
    expect(fit.hidden).toEqual(['c']);
    expect(fit.reservedWidth).not.toBe('0%');
    expect(sum({ ...fit.widths, reserved: fit.reservedWidth }, fit.expanderWidth)).toBeCloseTo(
      100,
      1,
    );
    expect(fitColumns([col('a')], 0, 40).reservedWidth).toBe('40px');
  });

  it('breaks priority ties by position', () => {
    const fit = fitColumns([col('a'), col('b'), col('c')], 200 + EXPANDER_WIDTH);
    expect(fit.shown).toEqual(['a', 'b']);
  });

  it('keeps the pinned columns on a container too narrow for them, by their minimums', () => {
    const fit = fitColumns([col('a', { pinned: true }), col('b', { pinned: true }), col('c')], 150);
    expect(fit.shown).toEqual(['a', 'b']);
    expect(fit.hidden).toEqual(['c']);
    expect(sum(fit.widths, fit.expanderWidth)).toBeCloseTo(100, 1);
    expect(fit.tableWidth).toBeNull();
  });
});

describe('fitColumns with columns resized by hand (#670)', () => {
  it('keeps the hand-set widths in px and shares the rest of the screen by weight', () => {
    // 1000 px: a is 300, b and c share 700 - 200 of minimums = 500 → 350 each.
    const fit = fitColumns([col('a'), col('b'), col('c')], 1000, 0, { a: 300 });
    expect(fit.shown).toEqual(['a', 'b', 'c']);
    expect(fit.widths).toEqual({ a: '300px', b: '350px', c: '350px' });
    expect(fit.tableWidth).toBe(1000);
  });

  it('never moves a column out: the table gets wider than the screen and scrolls', () => {
    const fit = fitColumns([col('a'), col('b'), col('c')], 300, 40, { a: 500 });
    expect(fit.hidden).toEqual([]);
    expect(fit.expanderWidth).toBeNull();
    expect(fit.widths).toEqual({ a: '500px', b: '100px', c: '100px' });
    expect(fit.reservedWidth).toBe('40px');
    expect(fit.tableWidth).toBe(740);
  });

  it('gives the other columns their minimum while unmeasured', () => {
    const fit = fitColumns([col('a'), col('b')], 0, 0, { b: 220 });
    expect(fit.widths).toEqual({ a: '100px', b: '220px' });
    expect(fit.tableWidth).toBe(320);
  });

  it('ignores the width of a column that is not shown', () => {
    const fit = fitColumns([col('a'), col('b')], 1000, 0, { gone: 300 });
    expect(fit.tableWidth).toBeNull();
    expect(fit.widths).toEqual({ a: '50%', b: '50%' });
  });
});
