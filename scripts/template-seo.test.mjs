import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { writeTemplatePages } from './template-pages.ts';
import { applyTemplateMetadata } from '../src/lib/templateMetadata.ts';
import { AGENT_RUNBOOKS } from '../shared/templates.ts';

const out='tmp/template-seo-test';
await mkdir(out,{recursive:true});
const shell=await readFile('index.html','utf8');
await writeFile(`${out}/index.html`,shell);
await writeFile(`${out}/sitemap.xml`,await readFile('public/sitemap.xml','utf8'));
await writeTemplatePages(out);
test('every generated page contains crawlable copy, steps, canonical, and a sitemap entry',async()=>{
  const sitemap=await readFile(`${out}/sitemap.xml`,'utf8');
  for(const t of AGENT_RUNBOOKS){
    const html=await readFile(`${out}/templates/${t.id}/index.html`,'utf8');
    assert.ok(html.includes(`<h1>${t.name}</h1>`));
    assert.ok(html.includes(t.useCase));
    assert.equal((html.match(/<li>/g)??[]).length,t.items.length);
    assert.equal((html.match(/rel="canonical"/g)??[]).length,1);
    assert.ok(sitemap.includes(`https://boop.ad/templates/${t.id}`));
  }
});
test('hard-loaded template metadata stays singular across details and restores shell on exit',async()=>{
  const oldHead=document.head.innerHTML;
  try {
    const html=await readFile(`${out}/templates/release-checklist/index.html`,'utf8');
    document.head.innerHTML=html.match(/<head>([\s\S]*?)<\/head>/)[1];
    const first=applyTemplateMetadata(AGENT_RUNBOOKS[0]);
    assert.equal(document.querySelectorAll('link[rel="canonical"]').length,1);
    first();
    const second=applyTemplateMetadata(AGENT_RUNBOOKS[1]);
    assert.equal(document.querySelectorAll('link[rel="canonical"]').length,1);
    assert.equal(document.querySelector('link[rel="canonical"]').href,'https://boop.ad/templates/research-pipeline');
    assert.equal(document.querySelector('meta[property="og:title"]').content,'Research pipeline | boop');
    second(); // Navigation to quickstart/home must not retain a runbook canonical.
    assert.equal(document.title,'boop');
    assert.equal(document.querySelector('link[rel="canonical"]'),null);
    assert.ok(!document.querySelector('meta[name="description"]').content.includes('research'));
    assert.ok(!document.querySelector('meta[property="og:title"]').content.includes('pipeline'));
  } finally {document.head.innerHTML=oldHead;}
});
