import { describe, expect, it } from "vitest";
import { nextSort, readSort, sortQuery, writeSort } from './listSort';

const FIELDS = ['name', 'createdAt'] as const;

describe('list sort', () => {
  it('reads a whitelisted field, ascending unless the URL says desc', () => {
    expect(readSort(new URLSearchParams('sort=name'), FIELDS)).toEqual({
      by: 'name',
      order: 'asc',
    });
    expect(readSort(new URLSearchParams('sort=createdAt&order=desc'), FIELDS)).toEqual({
      by: 'createdAt',
      order: 'desc',
    });
    expect(readSort(new URLSearchParams('sort=name&order=DROP'), FIELDS)?.order).toBe('asc');
  });

  it('ignores a field outside the list (the default order applies)', () => {
    expect(readSort(new URLSearchParams('sort=password&order=desc'), FIELDS)).toBeNull();
    expect(readSort(new URLSearchParams(), FIELDS)).toBeNull();
  });

  it('writes the sort, and nothing for the default order', () => {
    const params = new URLSearchParams('q=a');
    writeSort(params, { by: 'name', order: 'desc' });
    expect(params.toString()).toBe('q=a&sort=name&order=desc');
    const none = new URLSearchParams('q=a');
    writeSort(none, null);
    expect(none.toString()).toBe('q=a');
  });

  it('cycles a header: ascending, descending, default; another header starts ascending', () => {
    const asc = nextSort(null, 'name');
    expect(asc).toEqual({ by: 'name', order: 'asc' });
    const desc = nextSort(asc, 'name');
    expect(desc).toEqual({ by: 'name', order: 'desc' });
    expect(nextSort(desc, 'name')).toBeNull();
    expect(nextSort(desc, 'createdAt')).toEqual({ by: 'createdAt', order: 'asc' });
  });

  it('maps to the API query fields', () => {
    expect(sortQuery({ by: 'name', order: 'desc' })).toEqual({
      sortBy: 'name',
      sortOrder: 'desc',
    });
    expect(sortQuery(null)).toEqual({});
  });
});
