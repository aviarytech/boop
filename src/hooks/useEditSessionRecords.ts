import { useEffect } from "react";
import { useConvex } from "convex/react";
import { useLocation } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authErrorData } from "../../convex/lib/authError";
import { useAuth } from "./useAuth";
import { signActionRecords } from "../lib/actionSigner";
import { flushEditSessions, setEditRecorder } from "../lib/editSessions";

/**
 * Records edit sessions for the signed-in account (src/lib/editSessions.ts):
 * installs the recorder that signs a session and sends its one record, and
 * closes open sessions when the author moves on: a route change (leaving an
 * item, a note or a list), the tab being hidden or the page unloading, and
 * coming back online. Hiding and unloading are best effort; the browser may
 * not let the signature and the request finish.
 */
export function useEditSessionRecords(): void {
  const convex = useConvex();
  const { token } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!token) return;
    setEditRecorder(async (itemId, editSession, after) => {
      // Unsigned when the device cannot sign now; the record is still written.
      const signed = await signActionRecords("recordItemEdit", { itemId, after });
      try {
        await convex.mutation(api.items.recordItemEdit, { itemId: itemId as Id<"items">, editSession, authToken: token, ...(signed ? { signed } : {}) });
      } catch (error) {
        // The item is gone or no longer editable by this account. Retrying cannot help, and a
        // removed item's open session was already recorded by the server when it was removed.
        if (authErrorData(error)?.code !== "FORBIDDEN") throw error;
      }
    });
    const flush = () => { void flushEditSessions(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    return () => {
      flush(); // signing out, or a new session token: close what this one opened
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
      setEditRecorder(null);
    };
  }, [convex, token]);

  useEffect(() => { void flushEditSessions(); }, [pathname]);
}
