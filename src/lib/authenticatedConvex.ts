import { identityAssertionFields } from "../../convex/lib/clientAuth";
/** One session adapter for browser and Capacitor reactive calls. */
import { useCallback, useMemo } from "react";
import { useQuery as convexQuery, useMutation as convexMutation, useAction as convexAction } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useAuth } from "../hooks/useAuth";
import { authenticatedOperations } from "./authenticatedOperations";

const assertionFields = new Set<string>(identityAssertionFields);
export function requiresSession(ref: FunctionReference<"query" | "mutation" | "action">): boolean {
  return authenticatedOperations.has(getFunctionName(ref));
}
export function sessionArgs<T extends Record<string, unknown>>(ref: FunctionReference<"query" | "mutation" | "action">, args: T, token: string | null): T & { authToken?: string } {
  if (!requiresSession(ref)) return args;
  if (!token) throw new Error("Sign in to continue");
  const clean = Object.fromEntries(Object.entries(args).filter(([key]) => !assertionFields.has(key)));
  return { ...clean, authToken: token } as T & { authToken: string };
}

// The adapters preserve Convex's function-reference inference. The casts are
// confined here because its generic rest tuple does not express injected args.
export const useQuery: typeof convexQuery = (ref, ...args) => {
  const { token } = useAuth();
  const input = args[0];
  const protectedQuery = requiresSession(ref);
  const next = input === "skip" || (protectedQuery && !token)
    ? "skip" : protectedQuery ? sessionArgs(ref, input ?? {}, token) : input ?? {};
  return convexQuery(ref, next as never);
};
export const useMutation: typeof convexMutation = (ref) => {
  const { token } = useAuth();
  const mutation = convexMutation(ref);
  return useMemo(() => {
    const wrap = (base: typeof mutation): typeof mutation => Object.assign(
      (args: Record<string, unknown> = {}) => base(...[sessionArgs(ref, args, token)] as never),
      { withOptimisticUpdate: (update: Parameters<typeof base.withOptimisticUpdate>[0]) => wrap(base.withOptimisticUpdate(update)) },
    ) as typeof mutation;
    return wrap(mutation);
  }, [ref, mutation, token]);
};
export const useAction: typeof convexAction = (ref) => {
  const { token } = useAuth();
  const action = convexAction(ref);
  return useCallback((args: Record<string, unknown> = {}) => action(...[sessionArgs(ref, args, token)] as never), [ref, action, token]) as typeof action;
};
