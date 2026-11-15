/**
 * Settings → "Agent enrollment code" (docs/agent-enrollment-codes.md).
 * Mints a one-time code, shows it once with a copy button and a countdown, and
 * lists the codes that can still be used so they can be revoked.
 * Rendered only when AGENT_ENROLLMENT_CODES_ENABLED is on.
 */
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ENROLLMENT_CODE_LABEL_MAX, ENROLLMENT_CODE_TTL_MS, formatEnrollmentCountdown } from "../../shared/enrollmentCode";
import { Icon } from "./ui/Icon";

type Minted = { id: Id<"agentEnrollmentCodes">; code: string; label: string | null; expiresAt: number };

function errorMessage(error: unknown): string {
  const data = error && typeof error === "object" && "data" in error ? error.data : null;
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return "Couldn't do that. Try again.";
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers and non-HTTPS pages.
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

export function AgentEnrollmentCode() {
  const mint = useAction(api.agentEnrollment.mintEnrollmentCode);
  const revoke = useMutation(api.agentEnrollment.revokeEnrollmentCode);
  const listed = useQuery(api.agentEnrollment.listEnrollmentCodes, {});

  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [minting, setMinting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The query isn't re-run as time passes, so expiry is applied here.
  const active = (listed ?? []).filter(code => code.expiresAt > now);
  // The code stays on screen until it expires, is revoked, or is redeemed.
  const shown = minted && minted.expiresAt > now && (listed === undefined || active.some(code => code.id === minted.id)) ? minted : null;
  const others = active.filter(code => code.id !== shown?.id);
  const ticking = active.length > 0 || shown !== null;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const handleMint = async () => {
    setMinting(true);
    setError(null);
    setCopied(false);
    try {
      const result = await mint(label.trim() ? { label: label.trim() } : {});
      setNow(Date.now());
      setMinted({ id: result.id, code: result.code, label: result.label, expiresAt: result.expiresAt });
      setLabel("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async () => {
    if (!shown) return;
    await copyText(shown.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id: Id<"agentEnrollmentCodes">) => {
    setRevoking(id);
    setError(null);
    try {
      await revoke({ codeId: id });
      if (minted?.id === id) setMinted(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--boop-card)] text-[var(--boop-muted)] shadow-[0_0_0_1px_var(--boop-line)] shrink-0">
          <Icon name="key" className="w-[18px] h-[18px]" />
        </span>
        <div>
          <p className="font-semibold text-[var(--boop-ink)] text-sm">Agent enrollment code</p>
          <p className="text-xs text-[var(--boop-muted)]">
            A one-time code that lets an agent ask for access to your lists. It works once and expires in {Math.round(ENROLLMENT_CODE_TTL_MS / 60000)} minutes.
          </p>
        </div>
      </div>

      {shown ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={shown.code}
              aria-label="Enrollment code"
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-[var(--boop-card)] text-[var(--boop-ink)] rounded-lg border border-[var(--boop-line)]"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--boop-muted)]" role="timer">
              {shown.label ? `${shown.label} · ` : ""}Expires in {formatEnrollmentCountdown(shown.expiresAt, now)}
            </p>
            <button
              onClick={() => handleRevoke(shown.id)}
              disabled={revoking === shown.id}
              className="text-xs font-medium text-red-600 dark:text-red-400 disabled:opacity-50"
            >
              {revoking === shown.id ? "Revoking…" : "Revoke"}
            </button>
          </div>
          <p className="text-xs text-[var(--boop-muted)]">
            Copy it now. It isn't shown again once you leave this screen.
          </p>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={ENROLLMENT_CODE_LABEL_MAX}
            placeholder="Label (optional)"
            aria-label="Label for the code"
            className="flex-1 min-w-0 px-3 py-2 text-sm bg-[var(--boop-card)] text-[var(--boop-ink)] rounded-lg border border-[var(--boop-line)]"
          />
          <button
            onClick={handleMint}
            disabled={minting}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {minting ? "Creating…" : "Create code"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {others.length > 0 && (
        <ul className="space-y-1" aria-label="Unused codes">
          {others.map(code => (
            <li key={code.id} className="flex items-center justify-between gap-2 text-xs text-[var(--boop-muted)]">
              <span className="truncate">
                {code.label ?? "Unused code"} · expires in {formatEnrollmentCountdown(code.expiresAt, now)}
              </span>
              <button
                onClick={() => handleRevoke(code.id)}
                disabled={revoking === code.id}
                className="font-medium text-red-600 dark:text-red-400 disabled:opacity-50"
              >
                {revoking === code.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
