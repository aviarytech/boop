import type { BuiltinTemplate } from "../../convex/lib/templateCatalog";

/** Restore the app shell on exit even when entry HTML was a prerendered runbook. */
export function applyTemplateMetadata(template?: BuiltinTemplate, unknownSlug = false) {
  const shellData = document.getElementById('boop-shell-metadata')?.textContent;
  const shell = shellData ? JSON.parse(shellData) as { title: string; canonical: string | null; meta: Record<string, string> } : null;
  const previousTitle = shell?.title ?? document.title;
  document.title = `${template?.name ?? (unknownSlug ? 'Template not found' : 'Agent runbook templates')} | boop`;
  const metadata = [
    ['name', 'description', template?.description ?? 'Ten practical agent runbooks for work you can review.'],
    ['property', 'og:title', document.title],
    ['property', 'og:description', template?.description ?? 'Ten practical agent runbooks for work you can review.'],
    ['property', 'og:url', `https://boop.ad/templates${template ? `/${template.id}` : ''}`],
    ['name', 'twitter:title', document.title],
    ['name', 'twitter:description', template?.description ?? 'Ten practical agent runbooks for work you can review.'],
    ['name', 'robots', unknownSlug ? 'noindex,follow' : 'index,follow'],
  ].map(([attribute, key, content]) => {
    const existing = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    const node = existing ?? document.createElement('meta');
    const previous = shell ? shell.meta[key] : node.content;
    node.setAttribute(attribute, key);
    node.content = content;
    if (!existing) document.head.appendChild(node);
    return () => { if (existing && previous !== undefined) node.content = previous; else node.remove(); };
  });
  const existingCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const previousCanonical = shell ? shell.canonical : existingCanonical?.href;
  const canonical = existingCanonical ?? document.createElement('link');
  canonical.rel = 'canonical';
  canonical.href = `https://boop.ad/templates${template ? `/${template.id}` : ''}`;
  document.head.appendChild(canonical);
  return () => {
    document.title = previousTitle;
    metadata.forEach(restore => restore());
    if (existingCanonical && previousCanonical) canonical.href = previousCanonical;
    else canonical.remove();
  };
}
