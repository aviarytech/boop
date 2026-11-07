import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "clean up expired access sessions",
  { minutes: 1 },
  internal.actorSession.cleanupExpiredSessions
);

crons.interval(
  "poll custom hostnames",
  { seconds: 60 },
  internal.siteActions.pollPendingCustomHostnames
);

crons.interval(
  // Reschedules itself while a batch was full (lwsAccess.ts cleanupInternal).
  "expire LWS access requests, spent jtis and access tokens",
  { minutes: 15 },
  internal.lwsAccess.cleanupInternal
);

export default crons;
