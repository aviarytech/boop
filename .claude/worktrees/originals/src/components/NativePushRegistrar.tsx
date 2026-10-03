/**
 * NativePushRegistrar — registers the native APNs push token with Convex once
 * after auth is established and the token is available.
 *
 * initPushNotifications() stores the APNs token in window.__pooAppAPNsToken
 * but has no access to the Convex client or userDid. This component bridges
 * that gap by polling briefly for the token after auth.
 *
 * Mount inside AuthenticatedLayout (renders null).
 */

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Capacitor } from "@capacitor/core";

export function NativePushRegistrar() {
  const { did } = useCurrentUser();
  const registerPushToken = useMutation(api.notifications.registerPushToken);
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    if (!did) return;
    if (!Capacitor.isNativePlatform()) return;

    // The APNs token may arrive slightly after auth — poll briefly.
    let attempts = 0;
    const interval = setInterval(async () => {
      const token = window.__pooAppAPNsToken;
      if (token) {
        clearInterval(interval);
        registered.current = true;
        try {
          await registerPushToken({ userDid: did, token, platform: "ios" });
        } catch (err) {
          console.error("[NativePushRegistrar] Failed to register token:", err);
        }
      }
      if (++attempts >= 20) {
        // Give up after 10 seconds — user may have denied permission.
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [did, registerPushToken]);

  return null;
}
