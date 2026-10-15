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
  "re-queue stale pending action record signatures",
  { hours: 1 },
  internal.actionRecords.sweepStalePending
);

export default crons;
