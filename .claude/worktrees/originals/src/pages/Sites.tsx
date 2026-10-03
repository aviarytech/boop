import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { useToast } from "../hooks/useToast";

export function Sites() {
  const navigate = useNavigate();
  const { did, isLoading } = useCurrentUser();
  const { haptic } = useSettings();
  const { addToast } = useToast();
  const generateUploadUrl = useAction(api.sites.generateSiteUploadUrl);
  const createSiteFromUpload = useAction(api.siteActions.createSiteFromUpload);
  const sites = useQuery(api.sites.listSites, did ? { ownerDid: did } : "skip");

  const [html, setHtml] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".html")) {
      setError("Drop an .html file for now.");
      haptic("error");
      return;
    }
    setHtml(await file.text());
    setSelectedFileName(file.name);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!did) {
      setError("No identity found yet.");
      haptic("error");
      return;
    }

    setIsCreating(true);
    setError(null);
    haptic("medium");

    try {
      const { uploadUrl, bucketKey } = await generateUploadUrl({ ownerDid: did });
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: new Blob([html], { type: "text/html; charset=utf-8" }),
      });

      if (!uploadResponse.ok) {
        throw new Error("The file upload did not land. Try again.");
      }

      const result = await createSiteFromUpload({ ownerDid: did, bucketKey });
      addToast("Your link is ready.");
      haptic("success");
      navigate(`/s/${result.siteId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not make that link yet.";
      setError(message);
      addToast(message, "error");
      haptic("error");
    } finally {
      setIsCreating(false);
    }
  };

  if (!did && !isLoading) return null;

  return (
    <div className="min-h-full pb-28 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-stone-900 dark:text-stone-50"
            style={{
              fontFamily: "Nunito, system-ui, sans-serif",
              fontWeight: 700,
              fontSize: "clamp(30px, 5.5vw, 40px)",
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            Sites
          </h1>
          <p className="mt-2 max-w-xl text-sm text-stone-500 dark:text-stone-400">
            Drop one HTML file, get your link, leave whenever you want.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl border border-stone-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="p-4 border-b border-stone-100 dark:border-gray-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">
                Drop your file
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Single-file HTML only for now. {selectedFileName ? `Loaded ${selectedFileName}.` : ""}
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-stone-100 dark:bg-gray-800 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200">
              <input type="file" accept=".html,text/html" onChange={handleFile} className="sr-only" />
              Choose HTML
            </label>
          </div>
          <textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            placeholder="Paste HTML here..."
            className="block min-h-[260px] w-full resize-y bg-stone-50 dark:bg-gray-950 p-4 font-mono text-sm text-stone-900 dark:text-stone-100 outline-none"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isCreating || !html.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 disabled:opacity-50"
        >
          {isCreating ? "Making your link..." : "Make my link"}
        </button>
      </form>

      <section>
        <h2 className="mb-3 text-lg font-bold text-stone-900 dark:text-stone-100">
          Your sites
        </h2>
        {sites === undefined ? (
          <div className="h-20 animate-pulse rounded-2xl bg-stone-100 dark:bg-gray-900" />
        ) : sites.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No sites yet. A blank slate, but with better lighting.
          </p>
        ) : (
          <div className="space-y-3">
            {sites.map((site) => (
              <Link
                key={site._id}
                to={`/s/${site._id}`}
                className="block rounded-2xl border border-stone-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-amber-300 dark:hover:border-amber-700 transition-colors"
              >
                <div className="font-semibold text-stone-900 dark:text-stone-100">
                  {site.primaryHostname?.hostname ?? "Untitled site"}
                </div>
                <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Portable identity: {site.scid.slice(0, 18)}...
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
