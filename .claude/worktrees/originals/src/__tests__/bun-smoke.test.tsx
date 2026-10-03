import { test, expect } from "bun:test";
import { createRoot } from "react-dom/client";
import { act } from "react";

test("bun + happy-dom + react 19 renders into the DOM", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  act(() => {
    root.render(<div data-testid="ok">ok</div>);
  });

  const node = container.querySelector("[data-testid='ok']");
  expect(node).not.toBeNull();
  expect(node?.textContent).toBe("ok");

  act(() => root.unmount());
  container.remove();
});
