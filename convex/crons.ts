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
  "clean up agent enrollment codes",
  { hours: 1 },
  internal.agentEnrollment.cleanupEnrollmentCodes
);

export default crons;
