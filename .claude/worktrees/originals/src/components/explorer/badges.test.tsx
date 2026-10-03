import { test, expect } from "bun:test";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { KindBadge } from "./KindBadge";
import { LayerBadge } from "./LayerBadge";
import { RowVerificationBadge } from "./RowVerificationBadge";

function renderInto(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<>{node}</>));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("KindBadge renders 'list' label", () => {
  const { container, cleanup } = renderInto(<KindBadge kind="list" />);
  expect(container.textContent).toContain("list");
  cleanup();
});

test("KindBadge renders 'site' label", () => {
  const { container, cleanup } = renderInto(<KindBadge kind="site" />);
  expect(container.textContent).toContain("site");
  cleanup();
});

test("LayerBadge renders did:cel / did:webvh / did:btco", () => {
  for (const layer of ["did:cel", "did:webvh", "did:btco"] as const) {
    const { container, cleanup } = renderInto(<LayerBadge layer={layer} />);
    expect(container.textContent).toContain(layer);
    cleanup();
  }
});

test("RowVerificationBadge renders nothing for 'none'", () => {
  const { container, cleanup } = renderInto(<RowVerificationBadge verification="none" />);
  expect(container.textContent).toBe("");
  cleanup();
});

test("RowVerificationBadge renders for 'verified', 'anchored', 'pending'", () => {
  for (const v of ["verified", "anchored", "pending"] as const) {
    const { container, cleanup } = renderInto(<RowVerificationBadge verification={v} />);
    expect(container.textContent?.length).toBeGreaterThan(0);
    cleanup();
  }
});
