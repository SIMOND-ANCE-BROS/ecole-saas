import { describe, expect, it } from "vitest";
import { offsetOf, pageCount, PAGE_SIZE, readPage, shownRange } from "./pagination";

describe("pageCount", () => {
  it("has one page for an empty list", () => expect(pageCount(0)).toBe(1));
  it("fills the last page partly", () => expect(pageCount(PAGE_SIZE + 1)).toBe(2));
  it("does not add a page for an exact multiple", () => expect(pageCount(PAGE_SIZE * 3)).toBe(3));
});

describe("readPage", () => {
  it("defaults to page 1", () => expect(readPage(undefined, 500)).toBe(1));
  it("reads a valid page", () => expect(readPage("3", 500)).toBe(3));
  it("takes the first value of a repeated parameter", () => expect(readPage(["2", "4"], 500)).toBe(2));
  it("ignores a malformed value", () => {
    expect(readPage("abc", 500)).toBe(1);
    expect(readPage("-2", 500)).toBe(1);
    expect(readPage("1.5", 500)).toBe(1);
  });
  it("turns page 0 into page 1", () => expect(readPage("0", 500)).toBe(1));
  it("clamps a page past the end to the last page (after a filter shrinks the list)", () =>
    expect(readPage("9", 120)).toBe(3));
  it("stays on page 1 for an empty list", () => expect(readPage("4", 0)).toBe(1));
});

describe("offsetOf and shownRange", () => {
  it("skips the previous pages", () => {
    expect(offsetOf(1)).toBe(0);
    expect(offsetOf(3)).toBe(PAGE_SIZE * 2);
  });
  it("shows the rows of the page, the last one cut at the total", () => {
    expect(shownRange(1, 134)).toEqual({ from: 1, to: 50 });
    expect(shownRange(3, 134)).toEqual({ from: 101, to: 134 });
  });
  it("shows nothing for an empty list", () => expect(shownRange(1, 0)).toEqual({ from: 0, to: 0 }));
});
