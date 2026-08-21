/**
 * Templates page - manage and use list templates.
 * Shows built-in templates and user's saved templates.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { createListAsset } from "../lib/originals";
import { listCreationErrorMessage } from "../lib/planLimit";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "../lib/builtinTemplates";

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
    did ? { userDid: did } : "skip"
  ) ?? [];
  
  const publicTemplates = useQuery(api.templates.getPublicTemplates) ?? [];

  // Mutations
  const createList = useMutation(api.lists.createList);
  const addItem = useMutation(api.items.addItem);
  const deleteTemplate = useMutation(api.templates.deleteTemplate);
  const createListFromTemplate = useMutation(api.templates.createListFromTemplate);

  const handleUseBuiltin = async (template: BuiltinTemplate) => {
    if (!did) return;
    
    setIsCreating(template.id);
    haptic('medium');

    try {
      const listAsset = await createListAsset(template.name, did);
      const listId = await createList({
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
        name: template.name,
        ownerDid: did,
        createdAt: Date.now(),
      });

      const now = Date.now();
      for (const item of template.items) {
        await addItem({
          listId,
          name: item.name,
          createdByDid: did,
          createdAt: now,
          priority: item.priority,
          description: item.description,
        });
      }

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
      const listAsset = await createListAsset(template.name, did);
      const listId = await createListFromTemplate({
        templateId: template._id,
        listName: template.name,
        userDid: did,
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
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
      await deleteTemplate({ templateId, userDid: did });
      haptic('success');
    } catch (err) {
      console.error("Failed to delete template:", err);
      haptic('error');
    }
  };

  if (userLoading || !did) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/d"
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <span>📁</span> Templates
        </h1>
      </div>

      {error && (
        <div className="mb-6 px-4 py-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-sm space-y-3">
          <div>{error}</div>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            View pricing →
          </Link>
        </div>
      )}

      {/* Built-in Templates */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          My Templates
        </h2>
        
        {userTemplates.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
            <p className="text-gray-500 dark:text-gray-400 mb-2">No templates yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
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
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{template.emoji}</span>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {template.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {template.description}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
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
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📄</span>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {template.name}
            </h3>
            {template.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {template.description}
              </p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
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
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
