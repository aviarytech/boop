/**
 * boop Database Schema
 *
 * Core tables for the collaborative list-sharing app with DID-based identity.
 * Uses Convex for real-time sync and offline support.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // DID logs table - stores did:webvh logs for resolution
  didLogs: defineTable({
    userDid: v.string(), // The user's did:webvh
    path: v.string(), // URL path slug (e.g. "user-abc123")
    log: v.string(), // JSONL content (one JSON object per line)
    updatedAt: v.number(),
  })
    .index("by_path", ["path"])
    .index("by_user_did", ["userDid"]),

  // Rate limits table - for tracking auth endpoint rate limits (Phase 9.2)
  rateLimits: defineTable({
    key: v.string(), // Unique identifier (IP address or session ID)
    endpoint: v.string(), // Endpoint being limited ("initiate" or "verify")
    attempts: v.number(), // Number of attempts in current window
    windowStart: v.number(), // Timestamp when current window started
    expiresAt: v.number(), // When this record can be cleaned up (windowStart + window duration)
  })
    .index("by_key_endpoint", ["key", "endpoint"])
    .index("by_expires_at", ["expiresAt"]),

  // Auth sessions table - for server-side OTP session storage (Phase 8)
  authSessions: defineTable({
    sessionId: v.string(), // Unique session identifier
    email: v.string(), // User's email address
    subOrgId: v.optional(v.string()), // Turnkey sub-organization ID
    otpId: v.optional(v.string()), // Turnkey OTP ID
    timestamp: v.number(), // Session creation timestamp
    verified: v.boolean(), // Whether OTP has been verified
    expiresAt: v.number(), // Session expiration timestamp
  })
    .index("by_session_id", ["sessionId"])
    .index("by_expires_at", ["expiresAt"]),

  // Users table - for display name lookup by DID
  users: defineTable({
    did: v.optional(v.string()), // did:webvh:... created client-side (null until first login completes)
    displayName: v.string(),
    createdAt: v.number(),
    // Turnkey auth fields (added in Phase 1.3)
    turnkeySubOrgId: v.optional(v.string()), // Turnkey sub-organization ID
    email: v.optional(v.string()), // User's email address
    lastLoginAt: v.optional(v.number()), // Last login timestamp
    legacyIdentity: v.optional(v.boolean()), // true if still using localStorage
    // Migration support (Phase 1.6)
    legacyDid: v.optional(v.string()), // Original localStorage DID before Turnkey migration
    // Referral bonus: extra lists earned by inviting friends (legacy)
    bonusLists: v.optional(v.number()),
    // Referral Pro: timestamp (ms) when referral-based Pro expires
    referralProUntil: v.optional(v.number()),
  })
    .index("by_did", ["did"])
    .index("by_turnkey_id", ["turnkeySubOrgId"])
    .index("by_email", ["email"])
    .index("by_legacy_did", ["legacyDid"]),

  // API keys - long-lived credentials for agents to authenticate over HTTP.
  // Only the SHA-256 hash of a key is stored; the raw key is shown once on creation.
  // Named `agentApiKeys`, not `apiKeys`: deployments still hold orphaned rows
  // from the removed Mission Control `apiKeys` table (different shape), which
  // would fail schema validation on deploy.
  agentApiKeys: defineTable({
    ownerDid: v.string(), // Owner's DID — the authorization identity
    keyHash: v.string(), // Lowercase hex SHA-256 of the raw key
    prefix: v.string(), // First 12 chars of the raw key, for display/identification
    label: v.string(), // Human-readable label
    scopes: v.array(v.string()), // Granted scopes, e.g. ["lists:read", "items:write"]
    agentDid: v.optional(v.string()), // Optional acting agent DID (attribution)
    createdAt: v.number(),
    revokedAt: v.optional(v.number()), // Set when revoked; unset means active
  })
    .index("by_hash", ["keyHash"])
    .index("by_owner", ["ownerDid"]),

  // Categories table - user-specific list organization (Phase 2)
  categories: defineTable({
    ownerDid: v.string(), // User who owns this category
    name: v.string(),
    order: v.number(), // Sort order (lower = first)
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerDid"])
    .index("by_owner_name", ["ownerDid", "name"]),

  // Bookmarks table - tracks which published lists a user has bookmarked
  bookmarks: defineTable({
    userDid: v.string(),
    listId: v.id("lists"),
    bookmarkedAt: v.number(),
  })
    .index("by_user", ["userDid"])
    .index("by_user_list", ["userDid", "listId"])
    .index("by_list", ["listId"]),

  // Lists table - each list is an Originals asset
  lists: defineTable({
    assetDid: v.string(), // Originals asset DID (did:cel at genesis, did:webvh once published)
    name: v.string(),
    ownerDid: v.string(), // Creator's DID
    categoryId: v.optional(v.id("categories")), // User's category for this list (Phase 2)
    createdAt: v.number(),
    // VC proof for list ownership (Phase 6 - Provenance Chain)
    vcProof: v.optional(v.object({
      type: v.string(), // e.g., "VerifiableCredential"
      issuer: v.string(), // DID of issuer
      issuanceDate: v.number(), // When VC was issued
      credentialSubject: v.object({
        id: v.string(), // Subject DID (list assetDid)
        ownerDid: v.string(), // Owner DID
      }),
      proof: v.optional(v.string()), // JWT or linked data proof
    })),
    // Custom grocery aisles created by users for this list.
    // Superseded by itemCategories; read only when materialising a list's set.
    customAisles: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      emoji: v.string(),
      order: v.number(),
    }))),
    // This list's own item categories. Absent means it still uses the built-in
    // grocery set; the first category edit materialises the full set here, after
    // which it is the complete truth for the list. Named itemCategories, not
    // categories, because `categoryId` above is the user's folder for the LIST —
    // a different concept on the same row.
    itemCategories: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      emoji: v.string(),
      order: v.number(),
    }))),
    // Item view mode preference: "alphabetical" (flat A-Z) or "categorized" (grouped by category)
    itemViewMode: v.optional(v.union(v.literal("alphabetical"), v.literal("categorized"))),
  })
    .index("by_owner", ["ownerDid"])
    .index("by_asset_did", ["assetDid"])
    .index("by_category", ["categoryId"]),

  // Serialized Originals AssetEnvelope per list — the signed CEL event log that
  // makes a list's did:cel verifiable. Kept off the lists row (~1.8KB at genesis,
  // and it grows per event) so the hot list subscriptions stay small; only the
  // provenance and publish paths read it.
  listEnvelopes: defineTable({
    listId: v.id("lists"),
    assetDid: v.string(),
    envelope: v.string(), // JSON.stringify(AssetEnvelope)
    updatedAt: v.number(),
    // When the GENESIS proof was signed, captured at write time so the list
    // index never has to parse the envelope. Immutable once set: later events
    // append, but events[0] does not change. Optional for rows written before
    // this field existed; backfillGenesisSealedAt fills them.
    genesisSealedAt: v.optional(v.number()),
  })
    .index("by_list", ["listId"])
    .index("by_asset_did", ["assetDid"]),

  // Items table - items within a list
  items: defineTable({
    listId: v.id("lists"),
    name: v.string(),
    checked: v.boolean(),
    createdByDid: v.string(), // DID of user who added item
    checkedByDid: v.optional(v.string()), // DID of user who checked item
    createdAt: v.number(),
    checkedAt: v.optional(v.number()),
    order: v.optional(v.number()), // Position in list (lower = higher in list)
    updatedAt: v.optional(v.number()), // Timestamp of last update (Phase 5.8 conflict resolution)
    // New fields for enhanced items
    description: v.optional(v.string()), // Notes/details for the item
    dueDate: v.optional(v.number()), // Due date timestamp
    url: v.optional(v.string()), // Link to PR, URL, or reference
    recurrence: v.optional(v.object({
      frequency: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
      interval: v.optional(v.number()), // Every N days/weeks/months (default 1)
      nextDue: v.optional(v.number()), // Next occurrence timestamp
      endDate: v.optional(v.number()), // Optional end date - stop recurring after this
    })),
    // Priority levels (high/medium/low)
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    // Tags - array of tag IDs
    tags: v.optional(v.array(v.id("tags"))),
    // Grocery aisle override — user-assigned aisle that takes priority over keyword auto-classification
    groceryAisle: v.optional(v.string()),
    // Parent item ID for sub-items
    parentId: v.optional(v.id("items")),
    // Optional assignee DID for Mission Control workflows
    assigneeDid: v.optional(v.string()),
    // Attachments — Railway Bucket objects. Legacy `v.id("_storage")` entries
    // exist only until the bucketBackfill migration runs once on this deploy.
    attachments: v.optional(v.array(v.union(
      v.id("_storage"),
      v.object({
        key: v.string(),
        contentType: v.string(),
        size: v.number(),
        sha256: v.string(),
      }),
    ))),
    // VC proofs for item actions (Phase 6 - Provenance Chain)
    vcProofs: v.optional(v.array(v.object({
      type: v.string(), // e.g., "ItemCreation", "ItemCompletion"
      issuer: v.string(), // DID of issuer
      issuanceDate: v.number(), // When action VC was issued
      action: v.string(), // "created", "completed", "modified"
      actorDid: v.string(), // Who performed the action
      proof: v.optional(v.string()), // JWT or linked data proof
    }))),
  })
    .index("by_list", ["listId"])
    .index("by_parent", ["parentId"])
    .index("by_due_date", ["listId", "dueDate"]),

  // Item assignees table - tracks who is assigned to each item (Phase 1 foundation)
  itemAssignees: defineTable({
    itemId: v.id("items"),
    listId: v.id("lists"),
    assigneeDid: v.string(),
    assignedByDid: v.string(),
    assignedAt: v.number(),
  })
    .index("by_item", ["itemId"])
    .index("by_list", ["listId"])
    .index("by_assignee", ["assigneeDid"])
    .index("by_item_assignee", ["itemId", "assigneeDid"]),

  // Activity stream table - immutable audit/events for collaborative timelines
  activities: defineTable({
    listId: v.id("lists"),
    itemId: v.optional(v.id("items")),
    actorDid: v.string(),
    type: v.union(
      v.literal("item_assigned"),
      v.literal("item_unassigned"),
      v.literal("presence_heartbeat"),
      v.literal("presence_offline"),
      v.literal("item_updated"),
      v.literal("list_updated")
    ),
    metadata: v.optional(v.object({
      assigneeDid: v.optional(v.string()),
      status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("offline"))),
      note: v.optional(v.string()),
    })),
    createdAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_item", ["itemId"])
    .index("by_actor", ["actorDid"])
    .index("by_list_created", ["listId", "createdAt"]),

  // Presence table - ephemeral collaborator presence state per list
  presence: defineTable({
    listId: v.id("lists"),
    userDid: v.string(),
    status: v.union(v.literal("active"), v.literal("idle"), v.literal("offline")),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_user", ["listId", "userDid"])
    .index("by_last_seen", ["lastSeenAt"]),

  // Tags table - for categorizing items
  tags: defineTable({
    listId: v.id("lists"),
    name: v.string(),
    color: v.string(), // Hex color code
    createdByDid: v.string(),
    createdAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_name", ["listId", "name"]),

  // List templates table - save lists as reusable templates
  listTemplates: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerDid: v.string(),
    items: v.array(v.object({
      name: v.string(),
      description: v.optional(v.string()),
      priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
      order: v.number(),
    })),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    isPublic: v.optional(v.boolean()), // Allow others to use this template
  })
    .index("by_owner", ["ownerDid"])
    .index("by_public", ["isPublic"]),

  // Push notification subscriptions (web push)
  pushSubscriptions: defineTable({
    userDid: v.string(),
    endpoint: v.string(),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
    createdAt: v.number(),
  })
    .index("by_user", ["userDid"])
    .index("by_endpoint", ["endpoint"]),

  // Push tokens (native iOS APNs + Android/Web)
  pushTokens: defineTable({
    userDid: v.string(),
    token: v.string(), // APNs device token or web push endpoint
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
    // For web push, store subscription details
    webPushKeys: v.optional(v.object({
      p256dh: v.string(),
      auth: v.string(),
    })),
    createdAt: v.number(),
  })
    .index("by_user", ["userDid"])
    .index("by_token", ["token"]),

  // Publications table - did:webvh publication tracking (Phase 4)
  publications: defineTable({
    listId: v.id("lists"),
    webvhDid: v.string(), // did:webvh:...
    publishedAt: v.number(),
    publishedByDid: v.string(), // Owner who published
    status: v.union(v.literal("active"), v.literal("unpublished")),
    didDocument: v.optional(v.string()), // Cached DID document JSON
    didLog: v.optional(v.string()), // DID log for verification
    // Bitcoin anchor tracking
    anchorStatus: v.optional(v.union(v.literal("pending"), v.literal("verified"), v.literal("none"))),
    anchorTxId: v.optional(v.string()), // Bitcoin transaction ID
    anchorBlockHeight: v.optional(v.number()), // Block height where anchor was confirmed
    anchorTimestamp: v.optional(v.number()), // When anchor was confirmed
  })
    .index("by_list", ["listId"])
    .index("by_webvh_did", ["webvhDid"])
    .index("by_status", ["status"]),

  // Single-file hosted sites. These are public, shareable HTML drops with
  // portable did:webvh identity. Kept separate from todo/list publication.
  // `storageId` is the legacy Convex-storage pointer, kept optional only until
  // the bucketBackfill migration runs once on this deploy.
  siteFiles: defineTable({
    storageId: v.optional(v.id("_storage")),
    bucketKey: v.optional(v.string()),
    contentType: v.string(),
    sha256: v.string(),
    byteLength: v.number(),
    createdAt: v.number(),
  })
    .index("by_sha256", ["sha256"]),

  sites: defineTable({
    ownerDid: v.string(),
    scid: v.string(),
    did: v.string(),
    primaryHostnameId: v.optional(v.id("siteHostnames")),
    fileId: v.id("siteFiles"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerDid"])
    .index("by_scid", ["scid"])
    .index("by_file", ["fileId"]),

  siteHostnames: defineTable({
    siteId: v.id("sites"),
    hostname: v.string(),
    kind: v.union(v.literal("boop_sub"), v.literal("custom")),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("redirected")
    ),
    isPrimary: v.boolean(),
    redirectTo: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Cloudflare-tracked fields (custom hostnames only)
    cfHostnameId: v.optional(v.string()),
    cfStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("moved"),
      v.literal("deleted"),
    )),
    cfSslStatus: v.optional(v.union(
      v.literal("initializing"),
      v.literal("pending_validation"),
      v.literal("pending_issuance"),
      v.literal("pending_deployment"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("deleted"),
    )),
    verificationErrors: v.optional(v.array(v.string())),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_hostname", ["hostname"])
    .index("by_site_primary", ["siteId", "isPrimary"]),

  siteDidLogEntries: defineTable({
    siteId: v.id("sites"),
    versionId: v.string(),
    entryJsonl: v.string(),
    signedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_version", ["siteId", "versionId"]),

  siteKeys: defineTable({
    siteId: v.id("sites"),
    keyType: v.union(v.literal("ed25519")),
    publicKeyMultibase: v.string(),
    encryptedPrivateKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_site", ["siteId"]),

  // Files associated with a site (images, sub-pages, CSS, JS, fonts, …).
  // Served at https://<sitehost>/_assets/<fileName>; stored in Railway Bucket
  // under "site-assets/<siteId>/<fileName>". Filename unique per site.
  siteAssets: defineTable({
    siteId: v.id("sites"),
    fileName: v.string(),
    bucketKey: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_site_filename", ["siteId", "fileName"]),

  // Comments table - threaded discussions on items
  comments: defineTable({
    itemId: v.id("items"),
    userDid: v.string(), // Author of the comment
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_item", ["itemId"])
    .index("by_user", ["userDid"]),

  // Subscriptions table - Stripe billing for freemium model
  subscriptions: defineTable({
    userId: v.id("users"), // Reference to users table
    stripeCustomerId: v.string(), // Stripe customer ID
    stripeSubscriptionId: v.optional(v.string()), // Stripe subscription ID (null for free tier)
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("team")),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing"),
      v.literal("incomplete")
    ),
    currentPeriodEnd: v.optional(v.number()), // Timestamp when current billing period ends
    cancelAtPeriodEnd: v.optional(v.boolean()), // Whether subscription will cancel at end of period
    teamSize: v.optional(v.number()), // For team plans: number of seats
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  // Referral codes table - unique invite code per user
  referralCodes: defineTable({
    userId: v.id("users"),
    code: v.string(), // Unique alphanumeric invite code
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_code", ["code"]),

  // Feedback table - in-app user feedback collection
  feedback: defineTable({
    userId: v.id("users"),
    source: v.union(v.literal("in_app"), v.literal("email_reply"), v.literal("ph"), v.literal("hn"), v.literal("twitter"), v.literal("other")),
    category: v.union(v.literal("bug"), v.literal("feature"), v.literal("praise"), v.literal("confusion"), v.literal("churn_risk")),
    body: v.string(),
    status: v.union(v.literal("new"), v.literal("acknowledged"), v.literal("acted_on"), v.literal("wont_fix")),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_source", ["source"]),

  // Referrals table - tracks successful invite→signup conversions
  referrals: defineTable({
    referralCodeId: v.id("referralCodes"),
    referrerId: v.id("users"), // User who sent the invite
    refereeId: v.id("users"),  // User who signed up via the link
    createdAt: v.number(),
    // Timestamp when 30-day Pro was awarded to both parties (null = not yet awarded)
    proGrantedAt: v.optional(v.number()),
  })
    .index("by_referrer", ["referrerId"])
    .index("by_referee", ["refereeId"]),

  // Bitcoin anchors table - list/item state anchored to Bitcoin signet (Phase 5 + 6)
  bitcoinAnchors: defineTable({
    // Reference to what is being anchored (list or item)
    listId: v.optional(v.id("lists")),
    itemId: v.optional(v.id("items")),
    // State hash and snapshot
    contentHash: v.string(), // SHA-256 hash of list/item state at anchor time
    stateSnapshot: v.optional(v.string()), // JSON of state at anchor time (for verification)
    // Network and status
    network: v.optional(v.union(v.literal("signet"), v.literal("mainnet"), v.literal("regtest"))),
    status: v.union(
      v.literal("pending"), // Anchor requested, awaiting inscription
      v.literal("inscribed"), // Successfully inscribed on Bitcoin
      v.literal("confirmed"), // Inscription confirmed (1+ blocks)
      v.literal("failed") // Inscription failed
    ),
    // Bitcoin transaction data (populated after inscription)
    txid: v.optional(v.string()), // Bitcoin transaction ID
    inscriptionId: v.optional(v.string()), // Ordinals inscription ID
    blockHeight: v.optional(v.number()), // Block height when confirmed
    confirmations: v.optional(v.number()), // Number of confirmations
    // Metadata
    requestedByDid: v.string(), // User who triggered the anchor
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    inscribedAt: v.optional(v.number()), // When inscribed to mempool
    confirmedAt: v.optional(v.number()), // When confirmed on-chain
    // Error info for failed anchors
    error: v.optional(v.string()),
  })
    .index("by_list", ["listId"])
    .index("by_item", ["itemId"])
    .index("by_status", ["status"])
    .index("by_txid", ["txid"])
    .index("by_list_created", ["listId", "createdAt"]),

  waitlist: defineTable({
    email: v.string(),
    source: v.optional(v.string()), // e.g. "landing_page"
    createdAt: v.number(),
  }).index("by_email", ["email"]),
});
