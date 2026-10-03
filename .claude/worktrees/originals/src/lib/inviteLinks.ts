const DEFAULT_INVITE_BASE_URL = "https://boop.ad";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return DEFAULT_INVITE_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

export function buildReferralInviteUrl(code: string): string {
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_INVITE_BASE_URL as string | undefined);
  return `${baseUrl}/invite/${encodeURIComponent(code)}`;
}
