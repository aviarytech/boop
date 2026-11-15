import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({ owners: defineTable({ did: v.string(), document: v.string() }) });
