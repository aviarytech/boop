import { identityAssertionFields } from "./clientAuth";
/** Public adapters authenticate before invoking private business handlers.
 * HTTP adapters use the internal registration of the same operation. Credentials
 * are checked inside the transaction, so key revocation and scopes cannot race a write.
 */
import { v, type PropertyValidators, type ObjectType, type VObject } from "convex/values";
import { mutation, query, action, internalMutation, internalQuery, internalAction } from "../_generated/server";
import type { MutationCtx, QueryCtx, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate, requireScope, type ResolvedActor, type Credentials } from "./actor";
import { authorizeResources, type ListResources } from "./permissions";
import { AuthError } from "./auth";

const credentials = { authToken: v.optional(v.string()), apiKey: v.optional(v.string()) };
// Temporary wire compatibility only. These assertions never grant access. Keep
// endpoint names and these fields until deployed browser/mobile versions are confirmed.
const optionalDid = v.optional(v.string());
const assertions = Object.fromEntries(identityAssertionFields.map(field => [field, optionalDid])) as Record<(typeof identityAssertionFields)[number], typeof optionalDid>;

type Assertions = ObjectType<typeof assertions>;
export type ActorCtx<C> = C & { actor: ResolvedActor; credentials: Credentials };
type Definition<C, A extends PropertyValidators, R> = {
  args: A;
  scope: import("./apiKeyHelpers").Scope;
  resources: (args: ObjectType<A>) => ListResources;
  handler: (ctx: ActorCtx<C>, args: ObjectType<A>) => R | Promise<R>;
};
function checkAssertions(actor: ResolvedActor, args: Assertions) {
  for (const key of identityAssertionFields) {
    const did = args[key];
    if (did !== undefined && did !== actor.did && did !== actor.legacyDid) {
      throw new AuthError("Identity assertion does not match authenticated account", "UNAUTHORIZED");
    }
  }
}
function prepare<C extends QueryCtx | MutationCtx | ActionCtx, A extends PropertyValidators, R>(definition: Definition<C, A, R>, resolve: (ctx: C, args: Credentials) => Promise<ResolvedActor>) {
  return {
    args: v.object({ ...assertions, ...definition.args, ...credentials }) as VObject<ObjectType<A> & Assertions & Credentials, A & typeof assertions & typeof credentials>,
    handler: async (ctx: C, args: ObjectType<A> & Assertions & Credentials): Promise<R> => {
      const actor = await resolve(ctx, args);
      requireScope(actor, definition.scope);
      checkAssertions(actor, args);
      if (ctx && typeof ctx === "object" && "db" in ctx) {
        await authorizeResources(ctx as unknown as QueryCtx | MutationCtx, actor, definition.resources(args));
      } else {
        const resources = definition.resources(args);
        await (ctx as ActionCtx).runQuery(internal.actorSession.authorize, {
          authToken: args.authToken, apiKey: args.apiKey,
          resources: {
            lists: resources.lists?.filter(id => id !== undefined),
            items: resources.items?.filter(id => id !== undefined),
            anchors: resources.anchors?.filter(id => id !== undefined),
            accounts: resources.accounts?.filter(id => id !== undefined),
          },
        });
      }
      // Only declared business arguments reach operations; credentials and old
      // identity assertions cannot be accidentally persisted via an args spread.
      const businessArgs = Object.fromEntries(Object.keys(definition.args).map(key => [key, (args as Record<string, unknown>)[key]])) as ObjectType<A>;
      return definition.handler(Object.assign({}, ctx, { actor, credentials: { authToken: args.authToken, apiKey: args.apiKey } }), businessArgs);
    },
  };
}
export function actorMutation<A extends PropertyValidators, R>(definition: Definition<MutationCtx, A, R>) {
  const config = prepare(definition, authenticate);
  return { public: mutation(config), internal: internalMutation(config) };
}
export function actorQuery<A extends PropertyValidators, R>(definition: Definition<QueryCtx, A, R>) {
  const config = prepare(definition, authenticate);
  return { public: query(config), internal: internalQuery(config) };
}
export function actorAction<A extends PropertyValidators, R>(definition: Definition<ActionCtx, A, R>) {
  const config = prepare(definition, (ctx, args): Promise<ResolvedActor> => ctx.runQuery(internal.actorSession.resolve, { authToken: args.authToken, apiKey: args.apiKey }));
  return { public: action(config), internal: internalAction(config) };
}
