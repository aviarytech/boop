import { v } from 'convex/values';
import { internalQuery, httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { authenticate, requireScope } from './lib/actor';
import { authorizeResources, canUserViewList } from './lib/permissions';
import { resourceUnavailable } from './lib/authError';
import { isDirectChildKey } from './lib/bucketKeys';
import { getObjectBody } from './lib/bucket';
import { extractTokenFromRequest } from './lib/jwt';
import { getCorsHeaders, handlerErrorResponse } from './lib/httpResponses';

/** Never returns a storage URL. Public reads are intentional and still require
 * a current publication; credentials never become part of the download URL. */
export const authorize = internalQuery({
  args: { itemId: v.id('items'), key: v.string(), authToken: v.optional(v.string()), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (args.authToken || args.apiKey) {
      const actor = await authenticate(ctx, args);
      requireScope(actor, 'items:read');
      await authorizeResources(ctx, actor, { items: [args.itemId] });
    } else if (!item || !await canUserViewList(ctx, item.listId, '')) {
      throw resourceUnavailable();
    }
    const entry = item?.attachments?.find(entry => typeof entry === 'object' && entry.key === args.key);
    if (!entry || typeof entry !== 'object' || !isDirectChildKey(args.key, `attachments/${args.itemId}`)) throw resourceUnavailable();
    return { contentType: entry.contentType };
  },
});

export const download = httpAction(async (ctx, request) => {
  const headers = { ...getCorsHeaders(request), 'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Origin, Authorization, Cookie, X-API-Key', 'X-Content-Type-Options': 'nosniff' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    const key = url.searchParams.get('key');
    if (!itemId || !key) throw resourceUnavailable();
    const args = { itemId: itemId as Id<'items'>, key, authToken: extractTokenFromRequest(request) ?? undefined,
      apiKey: request.headers.get('X-API-Key') ?? undefined };
    await ctx.runQuery(internal.attachmentDownload.authorize, args);
    const body = await getObjectBody(key);
    // Revocation/deletion during storage I/O must not release fetched bytes.
    const entry = await ctx.runQuery(internal.attachmentDownload.authorize, args);
    return new Response(body, { headers: { ...headers, 'Content-Type': entry.contentType,
      'Content-Disposition': 'attachment' } });
  } catch (error) {
    const response = handlerErrorResponse(request, error, 'Attachment unavailable');
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
});
