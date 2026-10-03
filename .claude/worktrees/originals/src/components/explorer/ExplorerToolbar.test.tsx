import { test, expect } from "bun:test";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { DEFAULT_COLUMN_PREFS } from "../../lib/explorerColumns";

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("clicking a kind chip toggles it on", () => {
  const calls: string[] = [];
  const { container, cleanup } = render(
    <ExplorerToolbar
      filters={{ kind: [], layer: [], verify: [], q: "" }}
      searchInput=""
      onSearch={() => {}}
      onToggleKind={(v) => calls.push(`kind:${v}`)}
      onToggleLayer={() => {}}
      onToggleVerify={() => {}}
      sort={{ key: "updated", dir: "desc" }}
      onSort={() => {}}
      columns={DEFAULT_COLUMN_PREFS}
      onToggleColumn={() => {}}
    />,
  );
  const chip = container.querySelector("[data-chip='kind:list']") as HTMLButtonElement;
  expect(chip).not.toBeNull();
  act(() => chip.click());
  expect(calls).toEqual(["kind:list"]);
  cleanup();
});

test("multi-select: chip with active state has aria-pressed=true", () => {
  const { container, cleanup } = render(
    <ExplorerToolbar
      filters={{ kind: ["list", "site"], layer: [], verify: [], q: "" }}
      searchInput=""
      onSearch={() => {}}
      onToggleKind={() => {}}
      onToggleLayer={() => {}}
      onToggleVerify={() => {}}
      sort={{ key: "updated", dir: "desc" }}
      onSort={() => {}}
      columns={DEFAULT_COLUMN_PREFS}
      onToggleColumn={() => {}}
    />,
  );
  expect(container.querySelector("[data-chip='kind:list']")?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("[data-chip='kind:site']")?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("[data-chip='layer:did:cel']")?.getAttribute("aria-pressed")).toBe("false");
  cleanup();
});

test("columns menu: toggling a column calls onToggleColumn", () => {
  const calls: string[] = [];
  const { container, cleanup } = render(
    <ExplorerToolbar
      filters={{ kind: [], layer: [], verify: [], q: "" }}
      searchInput=""
      onSearch={() => {}}
      onToggleKind={() => {}}
      onToggleLayer={() => {}}
      onToggleVerify={() => {}}
      sort={{ key: "updated", dir: "desc" }}
      onSort={() => {}}
      columns={DEFAULT_COLUMN_PREFS}
      onToggleColumn={(k) => calls.push(k)}
    />,
  );
  const trigger = container.querySelector("[data-columns-trigger]") as HTMLButtonElement;
  expect(trigger).not.toBeNull();
  act(() => trigger.click());
  const item = container.querySelector("[data-column-toggle='identifier']") as HTMLButtonElement;
  expect(item).not.toBeNull();
  act(() => item.click());
  expect(calls).toEqual(["identifier"]);
  cleanup();
});
