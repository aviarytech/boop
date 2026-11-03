/**
 * Identifier details for published lists.
 *
 * DID/document presence is metadata, not a verification result.
 */

import { useState } from "react";

interface VerificationBadgeProps {
  /** The did:webvh DID of the published list */
  did: string;
  /** The DID document JSON string (optional) */
  didDocument?: string | null;
}

export function VerificationBadge({ did, didDocument }: VerificationBadgeProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Parse DID document if available
  let parsedDocument: Record<string, unknown> | null = null;
  if (didDocument) {
    try {
      const value: unknown = JSON.parse(didDocument);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsedDocument = value as Record<string, unknown>;
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  return (
    <div className="relative">
      {/* Badge button */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--boop-panel)] text-[var(--boop-muted)] rounded-full text-sm font-medium hover:bg-[color-mix(in_oklch,var(--boop-ink)_7%,var(--boop-panel))] transition-colors"
        aria-expanded={showDetails}
        aria-label="Identifier details"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0"
          />
        </svg>
        DID (unverified)
        <svg
          className={`w-3 h-3 transition-transform ${
            showDetails ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Details dropdown */}
      {showDetails && (
        <div className="absolute right-0 mt-2 w-80 bg-[var(--boop-card)] rounded-lg shadow-lg border border-[var(--boop-line)] p-4 z-10">
          <h3 className="text-sm font-semibold text-[var(--boop-ink)] mb-3">
            Identifier Details
          </h3>

          <div className="space-y-3">
            {/* DID */}
            <div>
              <label className="block text-xs font-medium text-[var(--boop-muted)] mb-1">
                Decentralized Identifier (DID)
              </label>
              <code className="block text-xs bg-[var(--boop-panel)] p-2 rounded break-all text-[var(--boop-ink)]">
                {did}
              </code>
            </div>

            {/* Verification Method */}
            {parsedDocument && Array.isArray(parsedDocument.verificationMethod) && (
              <div>
                <label className="block text-xs font-medium text-[var(--boop-muted)] mb-1">
                  Declared verification method (unverified)
                </label>
                <code className="block text-xs bg-[var(--boop-panel)] p-2 rounded break-all text-[var(--boop-ink)]">
                  {String((parsedDocument.verificationMethod[0] as Record<string, unknown>)?.id ?? "Unknown")}
                </code>
              </div>
            )}

            {/* Explanation */}
            <div className="pt-2 border-t border-[var(--boop-line)]">
              <p className="text-xs text-[var(--boop-muted)]">
                This list has a decentralized identifier (DID). This view does not
                verify the DID document or the list's authenticity, ownership, or
                authorship. Historical attribution records may be unsigned.
              </p>
            </div>

            {/* Actions */}
            <div className="pt-2 flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(did);
                  } catch {
                    // Ignore clipboard errors
                  }
                }}
                className="flex-1 text-xs px-3 py-1.5 bg-[var(--boop-panel)] text-[var(--boop-ink)] rounded hover:bg-[color-mix(in_oklch,var(--boop-ink)_7%,var(--boop-panel))]"
              >
                Copy DID
              </button>
              {parsedDocument && (
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(parsedDocument, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "did-document.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-1 text-xs px-3 py-1.5 bg-[var(--boop-panel)] text-[var(--boop-ink)] rounded hover:bg-[color-mix(in_oklch,var(--boop-ink)_7%,var(--boop-panel))]"
                >
                  Download Doc
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
