import { test, expect } from "bun:test";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ExplorerRow } from "./ExplorerRow";
import type { ExplorerRow as ExplorerRowType } from "../../lib/explorer";
import { DEFAULT_COLUMN_PREFS } from "../../lib/explorerColumns";

const baseList: ExplorerRowType = {
  id: "list:L1",
  source: "list",
  sourceId: "L1",
  title: "Groceries",
  identifier: null,
  layer: "did:cel",
  verification: "none",
  createdAt: 1,
  updatedAt: 1,
};

const baseSite: ExplorerRowType = {
  id: "site:S1",
  source: "site",
  sourceId: "S1",
  title: "brisk-paper-07.boop.ad",
  identifier: "brisk-paper-07.boop.ad",
  layer: "did:webvh",
  verification: "verified",
  createdAt: 1,
  updatedAt: 1,
};

function renderRow(row: ExplorerRowType, columns = DEFAULT_COLUMN_PREFS) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/e"]}>
        <Routes>
          <Route path="/e" element={<ExplorerRow row={row} columns={columns} />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("renders title", () => {
  const { container, cleanup } = renderRow(baseList);
  expect(container.textContent).toContain("Groceries");
  cleanup();
});

test("renders kind badge and layer for list", () => {
  const { container, cleanup } = renderRow(baseList);
  expect(container.textContent).toContain("list");
  expect(container.textContent).toContain("did:cel");
  cleanup();
});

test("renders verification badge when not 'none'", () => {
  const { container, cleanup } = renderRow(baseSite);
  expect(container.textContent).toContain("Verified");
  cleanup();
});

test("does NOT render verification badge for 'none'", () => {
  const { container, cleanup } = renderRow(baseList);
  expect(container.textContent).not.toContain("Verified");
  expect(container.textContent).not.toContain("Anchored");
  expect(container.textContent).not.toContain("Pending");
  cleanup();
});

test("clicking a list row navigates to /list/:id", () => {
  const { container, cleanup } = renderRow(baseList);
  const rowEl = container.querySelector("[data-row-id]") as HTMLElement;
  expect(rowEl?.getAttribute("href")).toBe("/list/L1");
  cleanup();
});

test("clicking a site row navigates to /s/:id", () => {
  const { container, cleanup } = renderRow(baseSite);
  const rowEl = container.querySelector("[data-row-id]") as HTMLElement;
  expect(rowEl?.getAttribute("href")).toBe("/s/S1");
  cleanup();
});

test("identifier column hidden by default", () => {
  const { container, cleanup } = renderRow(baseSite, DEFAULT_COLUMN_PREFS);
  expect(container.querySelector("[data-column='identifier']")).toBeNull();
  cleanup();
});

test("identifier column visible when toggled on", () => {
  const { container, cleanup } = renderRow(baseSite, {
    ...DEFAULT_COLUMN_PREFS,
    identifier: true,
  });
  expect(container.querySelector("[data-column='identifier']")).not.toBeNull();
  cleanup();
});

test("anchor txid column empty when verification !== 'anchored'", () => {
  const { container, cleanup } = renderRow(
    { ...baseSite, anchorTxId: "tx-abc" },
    { ...DEFAULT_COLUMN_PREFS, anchorTxidPrefix: true },
  );
  const col = container.querySelector("[data-column='anchorTxidPrefix']");
  expect(col).not.toBeNull();
  expect(col?.textContent).toBe("");
  cleanup();
});

test("anchor txid column shows prefix when 'anchored'", () => {
  const anchored: ExplorerRowType = {
    ...baseList,
    verification: "anchored",
    anchorTxId: "abcdef0123456789",
  };
  const { container, cleanup } = renderRow(anchored, {
    ...DEFAULT_COLUMN_PREFS,
    anchorTxidPrefix: true,
  });
  const col = container.querySelector("[data-column='anchorTxidPrefix']");
  expect(col?.textContent).toContain("abcdef01");
  cleanup();
});
