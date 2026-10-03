import { test, expect, beforeEach, spyOn } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";
import { useExplorerFilters } from "./useExplorerFilters";
import * as columns from "../lib/explorerColumns";

beforeEach(() => {
  localStorage.clear();
});

function wrapper(initialEntries: string[]) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

test("URL search params round-trip into state", () => {
  const { result } = renderHook(() => useExplorerFilters(), {
    wrapper: wrapper(["/e?kind=list,site&layer=did:webvh&q=brisk"]),
  });
  expect(result.current.filters.kind).toEqual(["list", "site"]);
  expect(result.current.filters.layer).toEqual(["did:webvh"]);
  expect(result.current.filters.q).toBe("brisk");
});

test("Default filter state when no params present", () => {
  const { result } = renderHook(() => useExplorerFilters(), {
    wrapper: wrapper(["/e"]),
  });
  expect(result.current.filters.kind).toEqual([]);
  expect(result.current.filters.layer).toEqual([]);
  expect(result.current.filters.verify).toEqual([]);
  expect(result.current.filters.q).toBe("");
});

test("toggleKindChip pushes a new history entry", () => {
  const { result } = renderHook(() => useExplorerFilters(), {
    wrapper: wrapper(["/e"]),
  });
  act(() => result.current.toggleKindChip("list"));
  expect(result.current.filters.kind).toEqual(["list"]);
  // Toggling again removes
  act(() => result.current.toggleKindChip("list"));
  expect(result.current.filters.kind).toEqual([]);
});

test("setSearchQuery debounces and uses replace (history doesn't grow per keystroke)", async () => {
  const { result } = renderHook(() => useExplorerFilters({ debounceMs: 30 }), {
    wrapper: wrapper(["/e"]),
  });
  act(() => result.current.setSearchQuery("a"));
  act(() => result.current.setSearchQuery("ab"));
  act(() => result.current.setSearchQuery("abc"));
  // Ephemeral reflects immediately
  expect(result.current.searchInput).toBe("abc");
  // URL hasn't been written yet
  expect(result.current.filters.q).toBe("");
  await new Promise((r) => setTimeout(r, 60));
  // After debounce, URL/state catches up
  expect(result.current.filters.q).toBe("abc");
});

test("Hook delegates column writes to saveColumnPrefs", () => {
  const spy = spyOn(columns, "saveColumnPrefs");
  try {
    const { result } = renderHook(() => useExplorerFilters(), {
      wrapper: wrapper(["/e"]),
    });
    act(() => result.current.toggleColumn("identifier"));
    expect(spy).toHaveBeenCalled();
    // And it actually round-trips through localStorage:
    expect(columns.loadColumnPrefs().identifier).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
