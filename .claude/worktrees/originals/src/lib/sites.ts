const DEFAULT_ADJECTIVES = [
  "brisk",
  "cosmic",
  "dapper",
  "fizzy",
  "gentle",
  "lucky",
  "merry",
  "tiny",
];

const DEFAULT_NOUNS = [
  "paper",
  "button",
  "garden",
  "lantern",
  "signal",
  "window",
  "studio",
  "sketch",
];

export interface GenerateHostnameOptions {
  baseDomain: string;
  isAvailable: (hostname: string) => Promise<boolean>;
  randomInt?: (maxExclusive: number) => number;
  pickAdjective?: () => string;
  pickNoun?: () => string;
  maxAttempts?: number;
}

function defaultRandomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function safeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function normalizeBaseDomain(baseDomain: string): string {
  return baseDomain
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();
}

export function buildBoopHostname(
  adjective: string,
  noun: string,
  digits: number,
  baseDomain: string
): string {
  const suffix = String(Math.abs(digits) % 100).padStart(2, "0");
  return `${safeLabel(adjective)}-${safeLabel(noun)}-${suffix}.${normalizeBaseDomain(baseDomain)}`;
}

export async function generateMemorableHostname(
  options: GenerateHostnameOptions
): Promise<string> {
  const randomInt = options.randomInt ?? defaultRandomInt;
  const maxAttempts = options.maxAttempts ?? 25;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const adjective =
      options.pickAdjective?.() ??
      DEFAULT_ADJECTIVES[randomInt(DEFAULT_ADJECTIVES.length)];
    const noun =
      options.pickNoun?.() ?? DEFAULT_NOUNS[randomInt(DEFAULT_NOUNS.length)];
    const hostname = buildBoopHostname(
      adjective,
      noun,
      randomInt(100),
      options.baseDomain
    );

    if (await options.isAvailable(hostname)) {
      return hostname;
    }
  }

  throw new Error("Could not find an available boop link. Try again in a moment.");
}

export function validateHtmlPayload(html: string, maxBytes = 4 * 1024 * 1024): string {
  const trimmed = html.trim();
  if (!trimmed) {
    throw new Error("Drop a little HTML first.");
  }

  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  if (byteLength > maxBytes) {
    throw new Error("That file is a bit too mighty for v1.");
  }

  return trimmed;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function appHostnameSet(baseDomain: string): Set<string> {
  const normalized = normalizeBaseDomain(baseDomain);
  return new Set([normalized, `www.${normalized}`]);
}
