#!/usr/bin/env node

const baseUrl = process.env.MISSION_CONTROL_BASE_URL;
const apiKey = process.env.MISSION_CONTROL_API_KEY;
const dryRun = process.env.MISSION_CONTROL_DRILL_DRY_RUN !== "false";

function fail(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

async function call(path, { method = "GET", body } = {}) {
  if (!baseUrl || !apiKey) {
    return { skipped: true, reason: "MISSION_CONTROL_BASE_URL or MISSION_CONTROL_API_KEY missing" };
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text() };
  }

  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("Mission Control readiness drill");
  console.log(`Mode: ${dryRun ? "dry-run" : "live"}`);

  const dashboard = await call("/api/v1/dashboard/runs");
  if (dashboard.skipped) {
    console.log(`⚠️ Skipping remote checks: ${dashboard.reason}`);
    ok("Readiness drill script wiring validated (env-less mode)");
    return;
  }
  if (!dashboard.ok) fail(`dashboard check failed (${dashboard.status})`);
  ok("dashboard/runs reachable");

  const retention = await call("/api/v1/runs/retention", {
    method: "POST",
    body: { dryRun: true, maxRuns: 20 },
  });
  if (!retention.ok) fail(`retention dry-run failed (${retention.status})`);
  ok("artifact retention dry-run succeeded");

  if (dryRun) {
    ok("Operator control simulation complete (dry-run, no run mutations sent)");
    return;
  }

  const runs = await call("/api/v1/runs?limit=1");
  if (!runs.ok) fail(`run list failed (${runs.status})`);
  const runId = runs.data?.runs?.[0]?._id;
  if (!runId) fail("no runs available to execute live drill", 2);

  const pause = await call(`/api/v1/runs/${runId}/pause`, { method: "POST", body: { reason: "readiness_drill" } });
  if (!pause.ok) fail(`pause failed (${pause.status})`);
  ok("pause action succeeded");

  const escalate = await call(`/api/v1/runs/${runId}/escalate`, { method: "POST", body: { reason: "readiness_drill" } });
  if (!escalate.ok) fail(`escalate failed (${escalate.status})`);
  ok("escalate action succeeded");

  console.log("🎯 Readiness drill completed");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
