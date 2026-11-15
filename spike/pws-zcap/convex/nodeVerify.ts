"use node";
// THROWAWAY spike code (#286). Gate 2: the same verifier in a Node action.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { verifyInvocation } from "./zcapVerify";

export const verify = internalAction({
  args: { input: v.string() },
  handler: async (_ctx, { input }) => verifyInvocation(JSON.parse(input)),
});
