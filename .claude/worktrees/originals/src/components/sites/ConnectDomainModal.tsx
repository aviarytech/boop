import { useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface ConnectDomainModalProps {
  siteId: Id<"sites">;
  ownerDid: string;
  hostname: string; // boop subdomain shown for context
  onClose: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "pending_dns" }
  | { kind: "pending_ssl" }
  | { kind: "active"; hostname: string }
  | { kind: "failed"; errors: string[] };

export function ConnectDomainModal({
  siteId,
  ownerDid,
  hostname,
  onClose,
}: ConnectDomainModalProps) {
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cnameTarget =
    (import.meta.env.VITE_CUSTOM_DOMAIN_CNAME_TARGET as string | undefined) ||
    "boop.ad";

  const requestCustomHostname = useAction(api.siteActions.requestCustomHostname);
  const site = useQuery(api.sites.getSite, { siteId, ownerDid });
  const customRow = site?.hostnames.find((h) => h.kind === "custom");

  const phase = derivePhase(customRow, submitting);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!domain.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestCustomHostname({ ownerDid, siteId, hostname: domain });
      setDomain("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-stone-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-stone-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">
              Connect a domain you own
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Your boop link stays around, even after your domain is connected.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-gray-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {phase.kind === "idle" && (
            <IdleForm
              domain={domain}
              setDomain={setDomain}
              cnameTarget={cnameTarget}
              onSubmit={handleSubmit}
              submitError={submitError}
              onClose={onClose}
            />
          )}
          {phase.kind === "submitting" && <SubmittingPanel />}
          {phase.kind === "pending_dns" && customRow && (
            <PendingDnsPanel hostname={customRow.hostname} cnameTarget={cnameTarget} onClose={onClose} />
          )}
          {phase.kind === "pending_ssl" && customRow && (
            <PendingSslPanel hostname={customRow.hostname} onClose={onClose} />
          )}
          {phase.kind === "active" && (
            <ActivePanel hostname={phase.hostname} onClose={onClose} />
          )}
          {phase.kind === "failed" && customRow && (
            <FailedPanel
              errors={phase.errors}
              hostname={customRow.hostname}
              hostnameId={customRow._id}
              ownerDid={ownerDid}
              onClose={onClose}
            />
          )}
          {phase.kind !== "active" && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              boop link <strong>{hostname}</strong> stays available the whole time.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function derivePhase(
  row:
    | {
        status: string;
        hostname: string;
        cfStatus?: string;
        cfSslStatus?: string;
        verificationErrors?: string[];
      }
    | undefined,
  submitting: boolean
): Phase {
  if (submitting) return { kind: "submitting" };
  if (!row) return { kind: "idle" };
  if (row.verificationErrors && row.verificationErrors.length > 0) {
    return { kind: "failed", errors: row.verificationErrors };
  }
  if (row.status === "active") {
    return { kind: "active", hostname: row.hostname };
  }
  if (row.cfStatus === "active" && row.cfSslStatus !== "active") {
    return { kind: "pending_ssl" };
  }
  return { kind: "pending_dns" };
}

function IdleForm({
  domain,
  setDomain,
  cnameTarget,
  onSubmit,
  submitError,
  onClose,
}: {
  domain: string;
  setDomain: (v: string) => void;
  cnameTarget: string;
  onSubmit: (e: FormEvent) => void;
  submitError: string | null;
  onClose: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="site-domain" className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
          Domain
        </label>
        <input
          id="site-domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="www.forexample.com"
          className="w-full rounded-xl border-2 border-stone-200 dark:border-gray-700 bg-stone-50 dark:bg-gray-950 px-4 py-3 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-500"
        />
      </div>
      <div className="rounded-xl bg-stone-50 dark:bg-gray-950 border border-stone-200 dark:border-gray-800 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          DNS instructions
        </p>
        <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
          Add a CNAME record pointing your domain to:
        </p>
        <code className="block rounded-lg bg-white dark:bg-gray-900 border border-stone-200 dark:border-gray-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 break-all">
          {cnameTarget}
        </code>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Apex domains are fussy on some DNS hosts. Start with <code>www</code>; set up an apex redirect after that.
        </p>
      </div>
      {submitError && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-200">
          {submitError}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl bg-stone-100 dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-200"
        >
          Not now
        </button>
        <button
          type="submit"
          disabled={!domain.trim()}
          className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          Connect
        </button>
      </div>
    </form>
  );
}

function SubmittingPanel() {
  return (
    <div className="rounded-xl bg-stone-50 dark:bg-gray-950 border border-stone-200 dark:border-gray-800 p-4 text-sm text-stone-700 dark:text-stone-200">
      Registering your domain…
    </div>
  );
}

function PendingDnsPanel({
  hostname,
  cnameTarget,
  onClose,
}: {
  hostname: string;
  cnameTarget: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-stone-50 dark:bg-gray-950 border border-stone-200 dark:border-gray-800 p-4 space-y-2 text-sm text-stone-700 dark:text-stone-200">
        <p>
          Waiting for the CNAME at <strong>{hostname}</strong> to point at <code>{cnameTarget}</code>.
        </p>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          This usually takes a few minutes after you add the record. We'll keep checking automatically.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-stone-100 dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-200"
      >
        Close
      </button>
    </div>
  );
}

function PendingSslPanel({ hostname, onClose }: { hostname: string; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-stone-50 dark:bg-gray-950 border border-stone-200 dark:border-gray-800 p-4 text-sm text-stone-700 dark:text-stone-200">
        DNS verified for <strong>{hostname}</strong>. Issuing SSL certificate…
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-stone-100 dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-200"
      >
        Close
      </button>
    </div>
  );
}

function ActivePanel({ hostname, onClose }: { hostname: string; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-sm text-emerald-800 dark:text-emerald-200">
        Connected. Your site is live at <strong>https://{hostname}</strong>.
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
      >
        Done
      </button>
    </div>
  );
}

function FailedPanel({
  errors,
  hostname,
  hostnameId,
  ownerDid,
  onClose,
}: {
  errors: string[];
  hostname: string;
  hostnameId: Id<"siteHostnames">;
  ownerDid: string;
  onClose: () => void;
}) {
  const retry = useAction(api.siteActions.retryCustomHostname);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await retry({ ownerDid, hostnameId });
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-4 text-sm text-rose-800 dark:text-rose-200 space-y-2">
        <p>We hit a snag connecting <strong>{hostname}</strong>:</p>
        <ul className="list-disc list-inside text-xs">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      </div>
      {retryError && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-200">
          {retryError}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl bg-stone-100 dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-200"
        >
          Close
        </button>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
      </div>
    </div>
  );
}
