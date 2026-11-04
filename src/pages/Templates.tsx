/**
 * Templates page - manage and use list templates.
 * Shows built-in templates and user's saved templates.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { trackTemplate } from "../lib/analytics";
import { getRunbook } from "../../convex/lib/templateCatalog";
import { listCreationErrorMessage } from "../lib/planLimit";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "../lib/builtinTemplates";
import { Icon } from "../components/ui/Icon";

type Template = Doc<"listTemplates">;

export function Templates() {
  const { did, isLoading: userLoading } = useCurrentUser();
  const { haptic } = useSettings();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch templates from API
  const userTemplates = useQuery(
    api.templates.getUserTemplates,
    did ? {} : "skip"
  ) ?? [];
  
  const publicTemplates = useQuery(api.templates.getPublicTemplates) ?? [];

  // Mutations
  const deleteTemplate = useMutation(api.templates.deleteTemplate);
  const createListFromTemplate = useMutation(api.templates.createListFromTemplate);

  const handleUseBuiltin = async (template: BuiltinTemplate) => {
    if (!did) return;
    
    setIsCreating(template.id);
    haptic('medium');

    try {
      if (getRunbook(template.id)) trackTemplate("template_use_clicked", template.id);
      const listId = await createListFromTemplate({
        builtinId: template.id,
        creationKey: crypto.randomUUID(),
        listName: template.name,
      });

      if (getRunbook(template.id)) trackTemplate("template_activated", template.id, listId);
      haptic('success');
      navigate(`/list/${listId}`);
    } catch (err) {
      console.error("Failed to create from template:", err);
      setError(listCreationErrorMessage(err));
      haptic('error');
      setIsCreating(null);
    }
  };

  const handleUseSaved = async (template: Template) => {
    if (!did) return;
    
    setIsCreating(template._id);
    setError(null);
    haptic('medium');

    try {
      const listId = await createListFromTemplate({
        templateId: template._id,
        listName: template.name,
        creationKey: crypto.randomUUID(),
      });

      haptic('success');
      navigate(`/list/${listId}`);
    } catch (err) {
      console.error("Failed to create from saved template:", err);
      setError(listCreationErrorMessage(err));
      haptic('error');
      setIsCreating(null);
    }
  };

  const handleDelete = async (templateId: Id<"listTemplates">) => {
    if (!did) return;
    
    haptic('medium');
    try {
      await deleteTemplate({ templateId });
      haptic('success');
    } catch (err) {
      console.error("Failed to delete template:", err);
      haptic('error');
    }
  };

  if (userLoading || !did) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-[var(--boop-panel)] rounded w-1/3" />
        <div className="h-32 bg-[var(--boop-panel)] rounded" />
        <div className="h-32 bg-[var(--boop-panel)] rounded" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <Link
        to="/d"
        className="inline-flex items-center gap-1.5 -ml-1 text-[15px] font-medium text-[var(--boop-muted)] hover:text-[var(--boop-ink)] transition-colors"
      >
        <Icon name="chevronLeft" className="w-5 h-5" />
        Back to lists
      </Link>
      <h1
        className="mt-5 mb-2 text-[var(--boop-ink)]"
        style={{ fontWeight: 780, fontVariationSettings: '"wdth" 86', fontSize: 'clamp(30px, 4.6vw, 40px)', letterSpacing: '-0.035em', lineHeight: 1.05 }}
      >
        Templates
      </h1>

      {error && (
        <div className="mb-6 px-4 py-4 bg-[var(--boop-accent-soft)] rounded-xl text-[var(--boop-accent-ink)] text-sm space-y-3">
          <div>{error}</div>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            View pricing →
          </Link>
        </div>
      )}

      <p className="mb-8"><Link to="/templates" className="text-[15px] font-semibold text-[var(--boop-accent)] hover:text-[var(--boop-accent-deep)]">Explore agent runbooks and step-by-step previews <Icon name="arrowRight" className="inline w-4 h-4 align-[-3px]" /></Link></p>
      {/* Built-in Templates */}
      <section className="mb-8">
        <h2 className="text-[20px] font-bold tracking-tight text-[var(--boop-ink)] mb-3">
          Quick Start Templates
        </h2>
        <div className="space-y-3">
          {BUILTIN_TEMPLATES.map((template) => (
            <BuiltinTemplateCard
              key={template.id}
              template={template}
              isCreating={isCreating === template.id}
              onUse={() => handleUseBuiltin(template)}
            />
          ))}
        </div>
      </section>

      {/* My Templates */}
      <section className="mb-8">
        <h2 className="text-[20px] font-bold tracking-tight text-[var(--boop-ink)] mb-3">
          My Templates
        </h2>
        
        {userTemplates.length === 0 ? (
          <div className="text-center py-8 bg-[var(--boop-panel)] rounded-2xl">
            <p className="text-[var(--boop-muted)] mb-2">No templates yet</p>
            <p className="text-sm text-[var(--boop-dim)]">
              Save a list as a template to reuse it later
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {userTemplates.map((template) => (
              <TemplateCard
                key={template._id}
                template={template}
                isOwner
                isCreating={isCreating === template._id}
                onUse={() => handleUseSaved(template)}
                onDelete={() => handleDelete(template._id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Public Templates */}
      {publicTemplates.filter((t) => t.ownerDid !== did).length > 0 && (
        <section>
          <h2 className="text-[20px] font-bold tracking-tight text-[var(--boop-ink)] mb-3">
            Public Templates
          </h2>
          <div className="space-y-3">
            {publicTemplates
              .filter((t) => t.ownerDid !== did)
              .map((template) => (
                <TemplateCard
                  key={template._id}
                  template={template}
                  isOwner={false}
                  isCreating={isCreating === template._id}
                  onUse={() => handleUseSaved(template)}
                />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface BuiltinTemplateCardProps {
  template: BuiltinTemplate;
  isCreating: boolean;
  onUse: () => void;
}

function BuiltinTemplateCard({ template, isCreating, onUse }: BuiltinTemplateCardProps) {
  return (
    <div className="bg-[var(--boop-card)] rounded-xl p-4 shadow-sm border border-[var(--boop-line)]">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{template.emoji}</span>
          <div>
            <h3 className="font-medium text-[var(--boop-ink)]">
              {template.name}
            </h3>
            <p className="text-sm text-[var(--boop-muted)] mt-1">
              {template.description}
            </p>
            <p className="text-xs text-[var(--boop-dim)] mt-2">
              {template.items.length} item{template.items.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        
        <button
          onClick={onUse}
          disabled={isCreating}
          className="px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {isCreating ? "Creating..." : "Use"}
        </button>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  template: Template;
  isOwner: boolean;
  isCreating: boolean;
  onUse: () => void;
  onDelete?: () => void;
}

function TemplateCard({ template, isOwner, isCreating, onUse, onDelete }: TemplateCardProps) {
  return (
    <div className="bg-[var(--boop-card)] rounded-xl p-4 shadow-sm border border-[var(--boop-line)]">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] shrink-0"><Icon name="file" className="w-[18px] h-[18px]" /></span>
          <div>
            <h3 className="font-medium text-[var(--boop-ink)]">
              {template.name}
            </h3>
            {template.description && (
              <p className="text-sm text-[var(--boop-muted)] mt-1">
                {template.description}
              </p>
            )}
            <p className="text-xs text-[var(--boop-dim)] mt-2">
              {template.items.length} item{template.items.length !== 1 ? "s" : ""}
              {template.isPublic && " • Public"}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={onUse}
            disabled={isCreating}
            className="px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {isCreating ? "Creating..." : "Use"}
          </button>
          {isOwner && onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 text-[var(--boop-dim)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Templates;
