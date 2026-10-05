import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AGENT_RUNBOOKS, getRunbook } from '../../convex/lib/templateCatalog';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMutation, useQuery } from '../lib/authenticatedConvex';
import { api } from '../../convex/_generated/api';
import { templateAsset, finishTemplateAttempt } from '../lib/templateActivation';
import { trackTemplate } from '../lib/analytics';
import { applyTemplateMetadata } from '../lib/templateMetadata';
import { REFERRAL_CODE_KEY } from './InviteLanding';
import { listCreationErrorMessage } from '../lib/planLimit';
import './ApiQuickstart.css';

export function TemplateGallery({ activation = false }: { activation?: boolean }) {
  const { slug } = useParams();
  const template = getRunbook(slug);
  const { did, subOrgId, isLoading } = useCurrentUser();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const create = useMutation(api.templates.createListFromTemplate);
  const redeemReferral = useMutation(api.referrals.redeemReferral);
  const accountRecord = useQuery(api.auth.getUserByTurnkeyId,
    activation && subOrgId ? { turnkeySubOrgId: subOrgId } : 'skip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const autoAttempted = useRef(false);
  const currentDid = useRef(did);
  currentDid.current = did;
  useEffect(() => {
    currentDid.current = did;
    return () => { currentDid.current = null; };
  }, [did]);

  useEffect(() => {
    document.body.classList.add('scrollable-page');
    const restoreMetadata = applyTemplateMetadata(template, !!slug && !template);
    if (template && !activation) trackTemplate('template_viewed', template.id);
    return () => {
      document.body.classList.remove('scrollable-page');
      restoreMetadata();
    };
  }, [template, slug, activation]);

  async function activate(automatic = false) {
    if (!template || started.current || isLoading || (activation && !accountRecord)) return;
    if (!automatic) trackTemplate('template_use_clicked', template.id);
    if (!did) {
      navigate(`/login?template=${template.id}`);
      return;
    }
    if (!activation) {
      navigate(`/templates/${template.id}/use?new=1`);
      return;
    }
    const account = did;
    started.current = true;
    setBusy(true);
    setError(null);
    try {
      // A signup can arrive here before AuthenticatedLayout's redeemer mounts.
      // Preserve first-list eligibility by awaiting idempotent redemption first.
      const referralCode = localStorage.getItem(REFERRAL_CODE_KEY);
      if (referralCode && accountRecord) {
        await redeemReferral({ code: referralCode, refereeUserId: accountRecord._id });
        if (currentDid.current !== account) return;
        if (localStorage.getItem(REFERRAL_CODE_KEY) === referralCode) localStorage.removeItem(REFERRAL_CODE_KEY);
      }
      const asset = await templateAsset(account, template.id, template.name, !automatic || search.get('new') === '1');
      if (currentDid.current !== account) throw new Error('Your account changed. Select the template again.');
      const listId = await create({ builtinId: template.id, listName: template.name,
        assetDid: asset.assetDid, celEnvelope: asset.envelope, expectedOwnerDid: account });
      if (currentDid.current !== account) return;
      finishTemplateAttempt(account, template.id);
      trackTemplate('template_activated', template.id, listId);
      navigate(`/list/${listId}`, { replace: true });
    } catch (err) {
      setError(listCreationErrorMessage(err));
    } finally {
      setBusy(false);
      started.current = false;
    }
  }

  // Creation is mounted only on the authenticated, app-unlocked /use route.
  // Consume explicit new-use intent before starting; pending retries retain their asset.
  useEffect(() => {
    if (template && search.get('use') === '1' && !activation) {
      navigate(`/templates/${template.id}/use`, { replace: true });
    } else if (activation && template && did && accountRecord && !isLoading && !started.current && !autoAttempted.current) {
      autoAttempted.current = true;
      if (search.has('new')) navigate(`/templates/${template.id}/use`, { replace: true });
      void activate(true);
    }
  }, [template, did, accountRecord, isLoading, search, activation]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="boop-quickstart">
    <nav className="qs-nav"><div className="qs-wrap qs-nav-inner">
      <Link className="qs-wordmark" to="/"><span className="qs-dot" />boop</Link>
      <Link to={did ? '/templates/saved' : '/login'}>{did ? 'My templates' : 'Sign in'}</Link>
    </div></nav>
    <main className="qs-wrap qs-main">
      {slug && !template ? <><h1>Template not found</h1><Link to="/templates">Browse agent runbooks</Link></> : template ? <>
        <Link to="/templates">← All agent runbooks</Link>
        <div className="qs-label mt-8">Agent runbook · {template.items.length} steps</div>
        <h1>{template.name}</h1><p className="qs-lede">{template.description}</p>
        <p>{template.useCase}</p>
        <button className="qs-btn mt-6" disabled={busy || isLoading} onClick={() => void activate()}>
          {busy ? 'Creating your list…' : error ? 'Retry template creation' : 'Use this template'}
        </button>
        <p className="mt-3 text-sm">{did ? 'Creates a private list in your account.' : 'Sign up or sign in to get a private list with every step preloaded.'} Your agent acts only with the access you grant.</p>
        {error && <div role="alert" className="mt-4"><p>{error}</p><Link to="/pricing">View plan limits</Link></div>}
        <section><h2>What you’ll have at the end</h2><p>{template.outcome}</p></section>
        <section><h2>The runbook</h2><ol className="space-y-6">
          {template.items.map((item, index) => <li key={item.order} className="border-t border-stone-300 pt-5">
            <h3 className="font-semibold">{index + 1}. {item.name}</h3><p className="mt-2">{item.description}</p>
          </li>)}
        </ol></section>
        <section><h2>Make it yours</h2><p>Replace the placeholders with your project context, assign owners, and connect an agent using the <Link to="/docs/quickstart">API quickstart</Link>. Review the steps before granting access; using a template does not execute the work.</p></section>
      </> : <>
        <div className="qs-label">Work together, step by step</div>
        <h1>Agent runbooks for work you can review.</h1>
        <p className="qs-lede">Ten ready-to-use checklists. Give an agent a bounded task, keep the evidence with the work, and make the human review explicit.</p>
        <div>{AGENT_RUNBOOKS.map((entry, index) => <article key={entry.id} className="border-t border-stone-300 py-7">
          <p className="qs-label">{String(index + 1).padStart(2, '0')} · {entry.items.length} steps</p>
          <h2><Link to={`/templates/${entry.id}`}>{entry.name} →</Link></h2>
          <p>{entry.description}</p>
        </article>)}</div>
      </>}
    </main>
  </div>;
}
