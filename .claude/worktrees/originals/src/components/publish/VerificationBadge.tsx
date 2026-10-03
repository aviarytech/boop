/**
 * Verification badge component for published lists.
 *
 * Phase 4: Shows verification status and DID details for published lists.
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
      parsedDocument = JSON.parse(didDocument);
    } catch {
      // Invalid JSON, ignore
    }
  }

  return (
    <div className="relative">
      {/* Badge button */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
        aria-expanded={showDetails}
        aria-label="Verification details"
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
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        Verified
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
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-10">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Verification Details
          </h3>

          <div className="space-y-3">
            {/* DID */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Decentralized Identifier (DID)
              </label>
              <code className="block text-xs bg-gray-100 p-2 rounded break-all text-gray-700">
                {did}
              </code>
            </div>

            {/* Verification Method */}
            {parsedDocument && Array.isArray(parsedDocument.verificationMethod) && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Verification Method
                </label>
                <code className="block text-xs bg-gray-100 p-2 rounded break-all text-gray-700">
                  {String((parsedDocument.verificationMethod[0] as Record<string, unknown>)?.id ?? "Unknown")}
                </code>
              </div>
            )}

            {/* Explanation */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-600">
                This list is published to a decentralized identifier (did:webvh).
                The DID document cryptographically proves the list's authenticity
                and ownership.
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
                className="flex-1 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
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
                  className="flex-1 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
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
