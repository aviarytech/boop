import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AGENT_RUNBOOKS } from '../convex/lib/templateCatalog';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Emit real crawlable HTML, using the same public-only catalog as the app/backend. */
export async function writeTemplatePages(outDir: string) {
  const shell = await readFile(resolve(outDir, 'index.html'), 'utf8');
  const shellMetadata = {
    title: shell.match(/<title>(.*?)<\/title>/)?.[1] ?? 'boop',
    canonical: shell.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null,
    meta: Object.fromEntries([...shell.matchAll(/<meta (?:name|property)="([^"]*)" content="([^"]*)"/g)].map(match => [match[1], match[2]])),
  };
  for (const template of [undefined, ...AGENT_RUNBOOKS]) {
    const path = `/templates${template ? `/${template.id}` : ''}`;
    const title = template ? `${template.name} | boop` : 'Agent runbook templates | boop';
    const description = template?.description ?? 'Ten practical agent runbooks for work you can review.';
    const body = template
      ? `<h1>${escape(template.name)}</h1><p>${escape(description)}</p><p>${escape(template.useCase!)}</p><h2>What you’ll have at the end</h2><p>${escape(template.outcome!)}</p><h2>The runbook</h2><ol>${template.items.map(i => `<li><h3>${escape(i.name)}</h3><p>${escape(i.description!)}</p></li>`).join('')}</ol><a href="/login?template=${template.id}">Use this template</a>`
      : `<h1>Agent runbooks for work you can review.</h1>${AGENT_RUNBOOKS.map(t => `<article><h2><a href="/templates/${t.id}">${escape(t.name)}</a></h2><p>${escape(t.description)}</p></article>`).join('')}`;
    const html = shell.replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`)
      .replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*("\s*\/>)/g, `$1${escape(description)}$2`)
      .replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*("\s*\/>)/g, `$1${escape(title)}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*("\s*\/>)/, `$1https://boop.ad${path}$2`)
      .replace('</head>', `<script id="boop-shell-metadata" type="application/json">${JSON.stringify(shellMetadata).replace(/</g, '\\u003c')}</script><link rel="canonical" href="https://boop.ad${path}" /></head>`)
      .replace('<div id="root"></div>', `<div id="root"><main><nav><a href="/">boop</a> · <a href="/templates">All agent runbooks</a></nav>${body}</main></div>`);
    await mkdir(resolve(outDir, path.slice(1)), { recursive: true });
    await writeFile(resolve(outDir, path.slice(1), 'index.html'), html);
  }
  const sitemap = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8');
  await writeFile(resolve(outDir, 'sitemap.xml'), sitemap.replace('</urlset>', ['/templates', ...AGENT_RUNBOOKS.map(t => `/templates/${t.id}`)].map(p => `<url><loc>https://boop.ad${p}</loc></url>`).join('\n') + '\n</urlset>'));
}
