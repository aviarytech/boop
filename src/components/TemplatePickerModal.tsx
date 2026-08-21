/**
 * Panel for selecting a template when creating a new list.
 * Shows built-in templates and user's saved templates.
 * Uses Panel component for slide-up drawer experience.
 */

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { createListAsset } from "../lib/originals";
import { listCreationErrorMessage } from "../lib/planLimit";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "../lib/builtinTemplates";
import { Panel } from "./ui/Panel";

interface TemplatePickerModalProps {
  onClose: () => void;
  onCreateBlank: () => void;
}

export function TemplatePickerModal({ onClose, onCreateBlank }: TemplatePickerModalProps) {
  const { did } = useCurrentUser();
  const navigate = useNavigate();
  const { haptic } = useSettings();

  const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplate | null>(null);
  const [customName, setCustomName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch user's saved templates
  const userTemplates = useQuery(
    api.templates.getUserTemplates,
    did ? { userDid: did } : "skip"
  );

  // Mutations
  const createList = useMutation(api.lists.createList);
  const addItem = useMutation(api.items.addItem);
  const createListFromTemplate = useMutation(api.templates.createListFromTemplate);

  const handleSelectBuiltin = (template: BuiltinTemplate) => {
    haptic('light');
    setSelectedTemplate(template);
    setCustomName(template.name);
  };

  const handleCreateFromBuiltin = async () => {
    if (!selectedTemplate || !did) return;

    const listName = customName.trim() || selectedTemplate.name;
    setError(null);
    setIsCreating(true);
    haptic('medium');

    try {
      // Create the list
      const listAsset = await createListAsset(listName, did);
      const listId = await createList({
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
        name: listName,
        ownerDid: did,
        createdAt: Date.now(),
      });

      // Add items from template
      const now = Date.now();
      for (const item of selectedTemplate.items) {
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
      console.error("Failed to create list from template:", err);
      setError(listCreationErrorMessage(err));
      haptic('error');
      setIsCreating(false);
    }
  };

  const handleCreateFromSaved = async (templateId: Id<"listTemplates">, templateName: string) => {
    if (!did) return;

    setError(null);
    setIsCreating(true);
    haptic('medium');

    try {
      const listAsset = await createListAsset(templateName, did);
      const listId = await createListFromTemplate({
        templateId,
        listName: templateName,
        userDid: did,
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
      });

      haptic('success');
      navigate(`/list/${listId}`);
    } catch (err) {
      console.error("Failed to create list from saved template:", err);
      setError(listCreationErrorMessage(err));
      haptic('error');
      setIsCreating(false);
    }
  };

  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">📁</span>
        <div>
          <h2 id="template-picker-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {selectedTemplate ? "Customize Template" : "Choose a Template"}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {selectedTemplate 
              ? "Customize the name or create with defaults"
              : "Start with a template or blank list"
            }
          </p>
        </div>
      </div>
      <button
        onClick={() => {
          haptic('light');
          onClose();
        }}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = (
    <div className="px-5 py-4 flex gap-3">
      <button
        type="button"
        onClick={() => {
          haptic('light');
          onClose();
        }}
        disabled={isCreating}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
      >
        Cancel
      </button>
      {selectedTemplate && (
        <button
          type="button"
          onClick={handleCreateFromBuiltin}
          disabled={isCreating}
          className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
        >
          {isCreating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating...
            </span>
          ) : (
            "Create List"
          )}
        </button>
      )}
    </div>
  );

  return (
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="template-picker-title"
    >
      {/* Content */}
      <div className="p-5">
        {selectedTemplate ? (
          /* Template customization view */
          <div className="space-y-4">
            <button
              onClick={() => {
                haptic('light');
                setSelectedTemplate(null);
              }}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to templates
            </button>

            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 flex items-start gap-3">
              <span className="text-2xl leading-none">{selectedTemplate.emoji}</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{selectedTemplate.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{selectedTemplate.items.length} items</p>
              </div>
            </div>

            <div>
              <label htmlFor="listName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                List name
              </label>
              <input
                id="listName"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={selectedTemplate.name}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50"
                disabled={isCreating}
              />
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Items included:
              </p>
              <ul className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 max-h-40 overflow-y-auto space-y-1">
                {selectedTemplate.items.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <span className="w-4 h-4 rounded border border-gray-300 dark:border-gray-600" />
                    <span>{item.name}</span>
                    {item.priority && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        item.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {item.priority}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}
          </div>
        ) : (
          /* Template selection view */
          <div className="space-y-6">
            {/* Blank list option */}
            <button
              onClick={() => {
                haptic('light');
                onCreateBlank();
              }}
              className="w-full flex items-center gap-4 p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-xl hover:border-amber-400 dark:hover:border-amber-600 transition-colors text-left"
            >
              <span className="text-2xl leading-none">✨</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">Blank List</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Start from scratch</p>
              </div>
            </button>

            {/* Built-in templates */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Quick Start Templates
              </h3>
              <div className="grid gap-3">
                {BUILTIN_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectBuiltin(template)}
                    className="w-full flex items-center gap-4 p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-md transition-all text-left"
                  >
                    <span className="text-2xl leading-none">{template.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{template.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{template.description}</p>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{template.items.length} items</span>
                  </button>
                ))}
              </div>
            </div>

            {/* User's saved templates */}
            {userTemplates && userTemplates.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  My Templates
                </h3>
                <div className="grid gap-3">
                  {userTemplates.map((template) => (
                    <button
                      key={template._id}
                      onClick={() => handleCreateFromSaved(template._id, template.name)}
                      disabled={isCreating}
                      className="w-full flex items-center gap-4 p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-md transition-all text-left disabled:opacity-50"
                    >
                      <span className="text-2xl leading-none">📄</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{template.name}</p>
                        {template.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{template.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{template.items.length} items</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default TemplatePickerModal;
