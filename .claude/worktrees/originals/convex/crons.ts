import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll custom hostnames",
  { seconds: 60 },
  internal.siteActions.pollPendingCustomHostnames
);

export default crons;
