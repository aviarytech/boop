# boop Agent API

REST API for programmatic access to boop lists and items. Designed for agents, scripts, and integrations to interact without using a browser.

## Base URL

```
https://<convex-deployment>.convex.site
```

## Authentication

Two auth modes are supported:

**JWT session** (for interactive/browser use) via the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

To obtain a JWT token, use the standard auth flow:
1. `POST /auth/initiate` with `{ "email": "your@email.com" }`
2. `POST /auth/verify` with `{ "sessionId": "...", "code": "..." }` (OTP from email)
3. Use the returned `token` in subsequent requests

**API key** (for unattended agents) via the `X-API-Key` header:

```
X-API-Key: pa_live_...
```

API keys are long-lived credentials scoped to specific actions. Mint one with a
JWT session (see [Agent API v1](#agent-api-v1)). When an `X-API-Key` header is
present it takes precedence over the `Authorization` header. Keys carry scopes
(`lists:read`, `items:read`, `items:write`); a request missing the required
scope returns `401`. JWT sessions have full access.

## Endpoints

### Lists

#### Get All Lists
```
GET /api/agent/lists
```

Returns all lists the authenticated user has access to.

**Response:**
```json
{
  "lists": [
    {
      "_id": "abc123...",
      "name": "Shopping List",
      "ownerDid": "did:webvh:...",
      "createdAt": 1704067200000,
      "role": "owner"
    }
  ]
}
```

#### Get List with Items
```
GET /api/agent/lists/:listId
GET /api/agent/lists/:listId/items
```

Returns a list and all its items.

**Response:**
```json
{
  "list": {
    "_id": "abc123...",
    "name": "Shopping List",
    "ownerDid": "did:webvh:...",
    "createdAt": 1704067200000,
    "assetDid": "did:peer:..."
  },
  "items": [
    {
      "_id": "item123...",
      "name": "Milk",
      "checked": false,
      "createdByDid": "did:webvh:...",
      "createdAt": 1704067200000,
      "order": 0,
      "description": "2% organic",
      "priority": "high"
    }
  ],
  "role": "owner"
}
```

#### Add Item to List
```
POST /api/agent/lists/:listId/items
Content-Type: application/json

{
  "name": "Buy groceries",
  "description": "From Whole Foods",
  "priority": "high",
  "dueDate": 1704153600000,
  "url": "https://example.com"
}
```

**Response (201 Created):**
```json
{
  "itemId": "item456...",
  "item": {
    "_id": "item456...",
    "name": "Buy groceries",
    "checked": false,
    "createdByDid": "did:webvh:...",
    "description": "From Whole Foods",
    "priority": "high",
    "dueDate": 1704153600000,
    "url": "https://example.com"
  }
}
```

### Items

#### Update Item
```
PATCH /api/agent/items/:itemId
Content-Type: application/json

{
  "checked": true,
  "name": "Updated name",
  "description": "Updated description",
  "priority": "medium",
  "dueDate": 1704240000000,
  "url": "https://new-url.com"
}
```

All fields are optional. To clear a field, set it to `null`:
```json
{
  "priority": null,
  "dueDate": null
}
```

**Response:**
```json
{
  "success": true,
  "item": {
    "_id": "item123...",
    "name": "Updated name",
    "checked": true,
    ...
  }
}
```

#### Delete Item
```
DELETE /api/agent/items/:itemId
```

**Response:**
```json
{
  "success": true
}
```

## Field Reference

### Item Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Item title (required for creation) |
| `description` | string | Optional notes/details |
| `checked` | boolean | Whether the item is complete |
| `priority` | "high" \| "medium" \| "low" | Priority level |
| `dueDate` | number | Unix timestamp in milliseconds |
| `url` | string | Link to PR, URL, or reference |
| `order` | number | Position in list (lower = higher) |
| `createdByDid` | string | DID of user who created the item |
| `checkedByDid` | string | DID of user who checked the item |
| `createdAt` | number | Creation timestamp |
| `checkedAt` | number | When item was checked |

### Roles

| Role | Permissions |
|------|-------------|
| `owner` | Full access (read, write, delete, share) |
| `editor` | Read and write access |
| `viewer` | Read-only access |

## Agent API v1

Endpoints for unattended agents: mint API keys (JWT-only), then read and write
boop lists using either a JWT session or an `X-API-Key`.

> Note: the Convex router has no `:param` path segments, so identifiers are
> passed as query parameters (`?keyId=`, `?listId=`) rather than path segments.

### API Keys (JWT only)

Key management always requires a JWT session — you cannot mint or revoke a key
with a key.

- `POST /api/v1/keys` — create a key.
  - body: `{ "label": "CI Agent", "scopes": ["lists:read","items:read","items:write"] }`
  - `scopes` is optional and defaults to `["lists:read","items:read","items:write"]`.
  - response: `{ "id": "...", "key": "pa_live_...", "prefix": "pa_live_..." }`
  - The raw `key` is returned **once** and never stored — save it immediately.
- `GET /api/v1/keys` — list your active keys.
  - response: `{ "keys": [{ "id", "prefix", "label", "scopes", "createdAt" }] }` (never the hash or raw key)
- `DELETE /api/v1/keys?keyId=<id>` — revoke a key you own.
  - response: `{ "success": true }`

### Reads (JWT or `X-API-Key`)

- `GET /api/v1/lists` — list the caller's lists (`lists:read`).
  - response: `{ "lists": [...] }`
- `GET /api/v1/lists/items?listId=<id>` — get a list and its items (`items:read`).
  - response: `{ "list": {...} | null, "items": [...] }`

### Writes (JWT or `X-API-Key`)

The existing mutation endpoints now also accept an `X-API-Key`. All require the
`items:write` scope (there is no `lists:write` scope yet):

- `POST /api/lists/create`, `POST /api/lists/delete`
- `POST /api/items/add`, `POST /api/items/check`, `POST /api/items/uncheck`,
  `POST /api/items/remove`, `POST /api/items/reorder`

Item writes made via an API key are attributed to the key's owner DID (or its
`agentDid`, if set). The item-authorship credential remains an unsigned
placeholder — cryptographic signing is out of scope for now.

### Scopes

- `lists:read` — read lists
- `items:read` — read items
- `items:write` — create/modify/delete lists and items

## Error Responses

All errors return JSON with an `error` field:

```json
{
  "error": "Error message here"
}
```

| Status | Description |
|--------|-------------|
| 400 | Bad request (missing/invalid parameters) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (no access to resource) |
| 404 | Not found |
| 405 | Method not allowed |
| 500 | Server error |

## Examples

### cURL

```bash
# Get all lists
curl -H "Authorization: Bearer $TOKEN" \
  https://your-deployment.convex.site/api/agent/lists

# Get a specific list with items
curl -H "Authorization: Bearer $TOKEN" \
  https://your-deployment.convex.site/api/agent/lists/abc123xyz

# Add an item
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New task", "priority": "high"}' \
  https://your-deployment.convex.site/api/agent/lists/abc123xyz/items

# Check off an item
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"checked": true}' \
  https://your-deployment.convex.site/api/agent/items/item123xyz

# Delete an item
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  https://your-deployment.convex.site/api/agent/items/item123xyz
```

### JavaScript/TypeScript

```typescript
const BASE_URL = "https://your-deployment.convex.site";
const TOKEN = "your-jwt-token";

// Get all lists
const lists = await fetch(`${BASE_URL}/api/agent/lists`, {
  headers: { Authorization: `Bearer ${TOKEN}` }
}).then(r => r.json());

// Add an item
const newItem = await fetch(`${BASE_URL}/api/agent/lists/${listId}/items`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "New task", priority: "high" })
}).then(r => r.json());

// Check off an item
await fetch(`${BASE_URL}/api/agent/items/${itemId}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ checked: true })
});
```
