/**
 * Built-in list templates that are always available.
 * Users can also create their own templates from existing lists.
 */

export interface BuiltinTemplateItem {
  name: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  order: number;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  items: BuiltinTemplateItem[];
  useCase?: string;
  outcome?: string;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "grocery",
    name: "Grocery List",
    emoji: "🛒",
    description: "Common grocery items to get you started",
    items: [
      { name: "Milk", order: 0 },
      { name: "Eggs", order: 1 },
      { name: "Bread", order: 2 },
      { name: "Butter", order: 3 },
      { name: "Cheese", order: 4 },
      { name: "Fruits", order: 5 },
      { name: "Vegetables", order: 6 },
      { name: "Chicken/Meat", order: 7 },
      { name: "Rice/Pasta", order: 8 },
      { name: "Snacks", order: 9 },
    ],
  },
  {
    id: "packing",
    name: "Packing Checklist",
    emoji: "🧳",
    description: "Essential items for your next trip",
    items: [
      { name: "Passport/ID", priority: "high", order: 0 },
      { name: "Phone charger", priority: "high", order: 1 },
      { name: "Toiletries", order: 2 },
      { name: "Medications", priority: "high", order: 3 },
      { name: "Clothes (underwear, socks)", order: 4 },
      { name: "Outerwear/jacket", order: 5 },
      { name: "Shoes", order: 6 },
      { name: "Laptop/tablet", order: 7 },
      { name: "Headphones", order: 8 },
      { name: "Sunglasses", order: 9 },
      { name: "Wallet/cards", priority: "high", order: 10 },
      { name: "Travel pillow", order: 11 },
    ],
  },
  {
    id: "weekly-tasks",
    name: "Weekly Tasks",
    emoji: "📅",
    description: "Common weekly chores and activities",
    items: [
      { name: "Grocery shopping", order: 0 },
      { name: "Laundry", order: 1 },
      { name: "Clean bathroom", order: 2 },
      { name: "Vacuum/mop floors", order: 3 },
      { name: "Take out trash", order: 4 },
      { name: "Meal prep", order: 5 },
      { name: "Exercise (3x)", priority: "medium", order: 6 },
      { name: "Review budget", order: 7 },
      { name: "Call family/friends", order: 8 },
    ],
  },
  {
    id: "project-kickoff",
    name: "Project Kickoff",
    emoji: "🚀",
    description: "Get your new project started right",
    items: [
      { name: "Define project goals", priority: "high", order: 0 },
      { name: "Identify stakeholders", priority: "high", order: 1 },
      { name: "Set timeline/milestones", priority: "high", order: 2 },
      { name: "Create project repo/workspace", order: 3 },
      { name: "Write initial documentation", order: 4 },
      { name: "Set up communication channel", order: 5 },
      { name: "Schedule kickoff meeting", order: 6 },
      { name: "Assign initial tasks", order: 7 },
      { name: "Define success metrics", priority: "medium", order: 8 },
    ],
  },
  {
    id: "moving",
    name: "Moving Checklist",
    emoji: "📦",
    description: "Everything you need for a smooth move",
    items: [
      { name: "Update address (mail, subscriptions)", priority: "high", order: 0 },
      { name: "Transfer utilities", priority: "high", order: 1 },
      { name: "Pack room by room", order: 2 },
      { name: "Label all boxes", order: 3 },
      { name: "Hire movers or rent truck", priority: "high", order: 4 },
      { name: "Clean old place", order: 5 },
      { name: "Get new keys", priority: "high", order: 6 },
      { name: "Set up internet/cable", order: 7 },
      { name: "Update driver's license", order: 8 },
      { name: "Notify bank/employers", order: 9 },
    ],
  },
  {
    id: "party-planning",
    name: "Party Planning",
    emoji: "🎉",
    description: "Plan the perfect celebration",
    items: [
      { name: "Set date and time", priority: "high", order: 0 },
      { name: "Create guest list", priority: "high", order: 1 },
      { name: "Send invitations", order: 2 },
      { name: "Plan menu/food", order: 3 },
      { name: "Order cake", order: 4 },
      { name: "Buy drinks", order: 5 },
      { name: "Get decorations", order: 6 },
      { name: "Create playlist", order: 7 },
      { name: "Plan activities/games", order: 8 },
      { name: "Set up day before", order: 9 },
    ],
  },
];

// Editorial, version-controlled catalog only. Never load private user templates here.
export const AGENT_RUNBOOKS: BuiltinTemplate[] = [
  {
    "id": "release-checklist",
    "name": "Release checklist",
    "emoji": "🚀",
    "description": "Ship a reviewed release with an agent preparing evidence and a human approving production changes.",
    "useCase": "For maintainers coordinating a release across code review, CI, rollout, and rollback.",
    "outcome": "A release decision with linked checks, a rollback owner, and recorded approval.",
    "items": [
      {
        "name": "Define the release boundary",
        "description": "Human: record the version, included PRs, release owner, maintenance window, and explicit out-of-scope changes.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Collect CI evidence",
        "description": "Agent: run the required checks on the exact release commit; attach commands, results, and failing logs. Stop on unexplained failures.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Review migration and rollback",
        "description": "Agent: identify schema/config changes and draft reversible rollout steps. Human: approve migration safety and name the rollback owner.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Draft release notes",
        "description": "Agent: summarize user-visible changes, known limitations, and upgrade steps; link every claim to a merged change.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Approve the rollout",
        "description": "Human: review the evidence and explicitly authorize deployment. A completed checklist does not itself authorize production access.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Verify and hand off",
        "description": "After an authorized rollout, record smoke checks, monitoring links, final version, and any follow-up issues.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "research-pipeline",
    "name": "Research pipeline",
    "emoji": "🔎",
    "description": "Turn a research question into a sourced decision brief an agent and reviewer can trust.",
    "useCase": "For teams comparing technical approaches or investigating an unfamiliar domain.",
    "outcome": "A concise recommendation with traceable sources, uncertainty, and a human review.",
    "items": [
      {
        "name": "Frame the question",
        "description": "Human: define the decision, audience, deadline, and what evidence would change the recommendation.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Build a source plan",
        "description": "Agent: list primary sources and search terms; record inclusion criteria and freshness requirements.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Gather evidence",
        "description": "Agent: capture source URLs, publication dates, and short evidence notes. Separate observations from inference.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Challenge the findings",
        "description": "Agent: seek counterexamples and contradictory sources; flag gaps and unsupported claims.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Draft the decision brief",
        "description": "Agent: compare options against the agreed criteria, cite claims, and describe confidence and tradeoffs.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Review and archive",
        "description": "Human: verify key citations and approve the recommendation; save the brief and unresolved questions.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "on-call-handoff",
    "name": "On-call handoff",
    "emoji": "📟",
    "description": "Give the next responder a clear picture of active incidents, mitigations, and escalation paths.",
    "useCase": "For rotating on-call teams that need continuity without repeating an investigation.",
    "outcome": "An acknowledged handoff with current risk, owners, and next checks.",
    "items": [
      {
        "name": "Set the handoff window",
        "description": "Human: record outgoing and incoming responders, timezone, shift window, and escalation contact.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Summarize active incidents",
        "description": "Agent: link incident records and timelines; state impact, current status, and last verified observations.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Document mitigations",
        "description": "Agent: list actions already taken, their observed effects, and any expiry or rollback conditions. Do not execute new changes.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Queue follow-up checks",
        "description": "Agent: create timed checks with dashboard links, expected signals, and thresholds requiring escalation.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Review access and coverage",
        "description": "Human: verify the incoming responder can reach the required dashboards and escalation channels; never paste secrets.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Acknowledge the handoff",
        "description": "Incoming responder: confirm ownership and next check time; outgoing responder resolves outstanding context questions.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "ci-triage",
    "name": "CI triage queue",
    "emoji": "🧪",
    "description": "Turn a failed build into a reproducible diagnosis and a focused fix proposal.",
    "useCase": "For maintainers handling flaky tests, broken builds, and blocked pull requests.",
    "outcome": "A classified failure with reproduction evidence and a reviewed remediation.",
    "items": [
      {
        "name": "Capture the failure",
        "description": "Agent: record the failing job URL, commit SHA, environment, and first meaningful error; redact tokens from logs.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Classify the cause",
        "description": "Agent: distinguish code regressions, flaky tests, infrastructure, and configuration problems using prior runs.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Reproduce in isolation",
        "description": "Agent: run the smallest relevant check on the failing commit; record exact commands and outcomes.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Propose a minimal fix",
        "description": "Agent: explain the root cause, affected behavior, and a targeted regression check. Avoid disabling a required gate.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Validate the change",
        "description": "Agent: rerun the focused check and affected suite; report unrelated failures separately.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Review and resolve",
        "description": "Human: review the diff and evidence, approve merge separately, and link the final CI result.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "content-production",
    "name": "Content production pipeline",
    "emoji": "✍️",
    "description": "Move a brief through research, drafting, fact-checking, and editorial approval.",
    "useCase": "For content teams using agents to draft while retaining editorial accountability.",
    "outcome": "A reviewed draft with verified claims, accessible assets, and a publication owner.",
    "items": [
      {
        "name": "Approve the brief",
        "description": "Human: define audience, angle, channel, length, deadline, and the desired reader action.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Collect references",
        "description": "Agent: gather primary sources, customer-approved examples, and brand constraints; record citation links.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Draft the narrative",
        "description": "Agent: write an outline and draft around the brief; mark assumptions and missing information explicitly.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Check claims and rights",
        "description": "Agent: verify factual statements, attribution, asset licenses, and sensitive material; flag unresolved concerns.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Edit for the reader",
        "description": "Human: review accuracy, voice, accessibility, and usefulness; request revisions before approval.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Prepare publication handoff",
        "description": "Agent: package approved copy, metadata, and assets. Human: authorize and schedule publication separately.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "audit-preparation",
    "name": "Compliance audit preparation",
    "emoji": "📋",
    "description": "Organize audit evidence with clear control owners and documented gaps.",
    "useCase": "For teams collecting evidence against a defined audit scope; this runbook does not certify compliance.",
    "outcome": "An evidence register and reviewer-approved gap list with responsible owners.",
    "items": [
      {
        "name": "Confirm audit scope",
        "description": "Human: identify the framework, period, systems, reviewer, and approved evidence storage location.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Map controls to owners",
        "description": "Agent: build a control-to-owner register with required evidence and due dates; flag unassigned controls.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Collect approved evidence",
        "description": "Agent: link authorized records with dates and provenance. Do not copy credentials or private customer data into tasks.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Assess evidence gaps",
        "description": "Agent: compare evidence against the stated requirements and period; distinguish missing evidence from failed controls.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Plan remediation",
        "description": "Human: prioritize gaps and assign owners; approve any system changes through the normal change process.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Review the evidence package",
        "description": "Human: validate completeness and access permissions before sharing; record reviewer questions and next actions.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "incident-review",
    "name": "Incident review",
    "emoji": "🧯",
    "description": "Reconstruct an incident and turn lessons into verifiable follow-up work.",
    "useCase": "For teams conducting a blameless review after service recovery.",
    "outcome": "A sourced timeline and prioritized corrective actions with owners and success checks.",
    "items": [
      {
        "name": "Define impact and scope",
        "description": "Human: record the incident window, affected users, severity, and review facilitator.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Reconstruct the timeline",
        "description": "Agent: correlate approved logs, alerts, and change records with timezone-normalized timestamps and links.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Identify contributing factors",
        "description": "Agent: distinguish observed causes from hypotheses; describe detection and recovery delays without assigning blame.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Draft corrective actions",
        "description": "Agent: propose bounded tasks with owners, due dates, and measurable verification steps.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Review with responders",
        "description": "Human: check the timeline and conclusions with participants; record disputed or unknown points.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Publish the approved review",
        "description": "Human: approve the audience and redactions; assign follow-up tracking and a date to verify improvements.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "dependency-upgrade",
    "name": "Dependency upgrade",
    "emoji": "📦",
    "description": "Assess an upgrade, test compatibility, and prepare a small reviewable change.",
    "useCase": "For maintainers keeping dependencies current without losing track of breaking changes.",
    "outcome": "A tested upgrade proposal with compatibility evidence and rollback instructions.",
    "items": [
      {
        "name": "Select the upgrade target",
        "description": "Human: specify package, current and target versions, reason, and supported runtimes.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Review upstream changes",
        "description": "Agent: read official release notes and migration guidance; list breaking changes and security advisories with links.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Update in isolation",
        "description": "Agent: adjust the dependency and lockfile using repository tooling; avoid unrelated upgrades.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Exercise compatibility",
        "description": "Agent: run relevant tests and builds, including affected runtime platforms; capture errors and fixes.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Document rollout and rollback",
        "description": "Agent: describe config or data changes, known limitations, and how to restore the prior version.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Request review",
        "description": "Human: assess the diff and validation evidence; approve merge and rollout through their separate gates.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "customer-feedback-triage",
    "name": "Customer feedback triage",
    "emoji": "💬",
    "description": "Convert authorized feedback into deduplicated, actionable product questions.",
    "useCase": "For product teams sorting support themes while protecting customer information.",
    "outcome": "A prioritized theme list with evidence, owners, and response drafts awaiting approval.",
    "items": [
      {
        "name": "Define the intake window",
        "description": "Human: choose approved feedback sources, reporting period, audience, and privacy rules.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Collect and redact",
        "description": "Agent: summarize authorized reports with internal references; remove personal details not needed for triage.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Group related reports",
        "description": "Agent: deduplicate issues by user need and observable behavior; preserve differing contexts and counterexamples.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Assess impact",
        "description": "Agent: estimate frequency and severity from evidence; label uncertain estimates and avoid inventing customer counts.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Route the next action",
        "description": "Human: choose investigation, bug fix, documentation, or no action; assign an owner and due date.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Prepare response drafts",
        "description": "Agent: draft accurate responses without promises of unapproved work. Human: approve any external communication.",
        "order": 5,
        "priority": "medium"
      }
    ]
  },
  {
    "id": "agent-task-handoff",
    "name": "Agent task handoff",
    "emoji": "🤝",
    "description": "Pass a bounded task between an agent and a human with enough context to continue safely.",
    "useCase": "For teams delegating implementation or investigation across sessions and contributors.",
    "outcome": "A reproducible handoff naming completed work, open blockers, and the next authorized action.",
    "items": [
      {
        "name": "State the objective and authority",
        "description": "Human: define acceptance criteria, owned files or resources, allowed actions, and approval boundaries.",
        "order": 0,
        "priority": "high"
      },
      {
        "name": "Record the starting state",
        "description": "Agent: capture branch or workspace, relevant docs, existing changes, and known environment constraints.",
        "order": 1,
        "priority": "medium"
      },
      {
        "name": "Execute the bounded task",
        "description": "Agent: work within the agreed scope; record material decisions and stop at missing authority or conflicting work.",
        "order": 2,
        "priority": "medium"
      },
      {
        "name": "Verify the deliverable",
        "description": "Agent: run focused checks against acceptance criteria; distinguish demonstrated behavior from untested assumptions.",
        "order": 3,
        "priority": "medium"
      },
      {
        "name": "Prepare the handoff",
        "description": "Agent: list changed files, evidence, remaining risks, reproduction steps, and the next concrete action.",
        "order": 4,
        "priority": "high"
      },
      {
        "name": "Accept ownership",
        "description": "Human or next agent: review the evidence, acknowledge blockers, and confirm the remaining authorized scope.",
        "order": 5,
        "priority": "medium"
      }
    ]
  }
];
BUILTIN_TEMPLATES.push(...AGENT_RUNBOOKS);
export function getRunbook(slug: string | null | undefined) {
  return AGENT_RUNBOOKS.find(template => template.id === slug);
}
export function templateLoginDestination(search: string): string {
  const template = getRunbook(new URLSearchParams(search).get('template'));
  return template ? `/templates/${template.id}/use` : '/d';
}
