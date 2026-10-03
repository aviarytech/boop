import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });

// Tell React 19 that `act()` is supported in this test environment.
// Without this, React emits a noisy console warning on every act() call.
(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
