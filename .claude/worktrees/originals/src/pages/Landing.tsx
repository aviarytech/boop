/**
 * Boop marketing landing page.
 *
 * Rewritten around three audience paths (issue #191):
 *   For you — collaborative lists (realtime, offline, mobile)
 *   For your team — shared workspaces, roles, activity
 *   For your agents — Mission Control API, run visibility, provenance
 *
 * Messaging follows the ladder in docs/business-plan.md §4: outcomes first,
 * no DID/VC/Bitcoin vocabulary above the fold.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trackLandingViewed, trackLandingCtaClicked } from '../lib/analytics';

// ---------------------------------------------------------------------------
// Agent demo — scripted loop of an agent checking items off in realtime.
// Self-contained animation (no backend); structured so the step feed could be
// swapped for a live list subscription later.
// ---------------------------------------------------------------------------

interface DemoItem {
  name: string;
  chip?: string;
}

const DEMO_ITEMS: DemoItem[] = [
  { name: 'Draft release notes', chip: 'docs' },
  { name: 'Run test suite', chip: 'ci' },
  { name: 'Bump version to 0.5.0' },
  { name: 'Update changelog', chip: 'docs' },
  { name: 'Tag and publish release', chip: '!! high' },
];

interface DemoStep {
  /** Index into DEMO_ITEMS to check off, or null for log-only steps. */
  check: number | null;
  /** Who did it — rendered as the actor chip on the item. */
  actor: 'agent' | 'human' | null;
  log: string;
  delay: number;
}

const DEMO_SCRIPT: DemoStep[] = [
  { check: null, actor: null, log: '$ release-bot · connecting to boop…', delay: 1200 },
  { check: null, actor: null, log: '✓ authenticated · list "Ship v0.5" · 5 open items', delay: 1400 },
  { check: 0, actor: 'agent', log: 'POST /api/items/check · "Draft release notes"', delay: 1600 },
  { check: 1, actor: 'agent', log: 'POST /api/items/check · "Run test suite"', delay: 1800 },
  { check: 2, actor: 'agent', log: 'POST /api/items/check · "Bump version to 0.5.0"', delay: 1600 },
  { check: 3, actor: 'human', log: '● jamie checked "Update changelog" from her phone', delay: 2000 },
  { check: 4, actor: 'agent', log: 'POST /api/items/check · "Tag and publish release"', delay: 1800 },
  { check: null, actor: null, log: '✓ run complete · 5/5 done · every action signed', delay: 3600 },
];

function AgentDemo() {
  const [step, setStep] = useState(-1);
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const current = step >= 0 ? DEMO_SCRIPT[step] : null;
    const delay = current ? current.delay : 600;
    timer.current = setTimeout(() => {
      setStep((s) => (s + 1 >= DEMO_SCRIPT.length ? -1 : s + 1));
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, reduced]);

  // With reduced motion, show the completed state as a still.
  const visibleSteps = reduced ? DEMO_SCRIPT : DEMO_SCRIPT.slice(0, step + 1);
  const checkedBy = new Map<number, 'agent' | 'human'>();
  for (const s of visibleSteps) {
    if (s.check !== null && s.actor) checkedBy.set(s.check, s.actor);
  }
  const doneCount = checkedBy.size;
  const progress = (doneCount / DEMO_ITEMS.length) * 100;
  const logLines = visibleSteps.slice(-4);

  return (
    <div className="shot demo" aria-label="Demo of an AI agent checking items off a shared list in realtime">
      <div className="demo-grid">
        <div className="mock demo-list">
          <div className="mock-head">
            <div>
              <div className="mock-tag">shared · live</div>
              <h3>Ship v0.5</h3>
            </div>
            <div className="avatars">
              <div className="avy avy-violet">R</div>
              <div className="avy avy-coral">J</div>
              <div className="avy avy-bot" title="release-bot (agent)">⚡</div>
            </div>
          </div>
          <div className="progress progress-lg"><div style={{ width: `${progress}%` }} /></div>
          {DEMO_ITEMS.map((item, i) => {
            const actor = checkedBy.get(i);
            return (
              <div key={item.name} className={`item demo-item${actor ? ' done' : ''}`}>
                <span className={`box${actor ? ' on' : ''}`} />
                <span className="t">{item.name}</span>
                {actor === 'agent' && <span className="chip chip-agent">⚡ agent · signed</span>}
                {actor === 'human' && <span className="chip chip-accent">jamie · signed</span>}
                {!actor && item.chip && <span className="chip">{item.chip}</span>}
              </div>
            );
          })}
        </div>
        <div className="demo-log" aria-hidden="true">
          <div className="demo-log-head">
            <span className="demo-log-dot" />
            <span>release-bot — live run</span>
          </div>
          <div className="demo-log-body">
            {logLines.map((s, i) => (
              <div key={`${s.log}-${i}`} className="demo-log-line">{s.log}</div>
            ))}
            {!reduced && <div className="demo-log-line demo-cursor">▌</div>}
          </div>
          <div className="demo-log-foot">an actual agent run — this is what your dashboard shows</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

export function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const appHref = isAuthenticated ? '/' : '/login';
  const viewTracked = useRef(false);

  useEffect(() => {
    document.body.classList.add('scrollable-page');
    return () => document.body.classList.remove('scrollable-page');
  }, []);

  // Session restoration is async, so authenticated users briefly mount Landing
  // before the "/" route redirects them to the app. Only count the view once
  // auth has resolved to a genuinely signed-out visitor.
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !viewTracked.current) {
      viewTracked.current = true;
      trackLandingViewed();
    }
  }, [isLoading, isAuthenticated]);

  const cta = (name: 'signup' | 'signin' | 'quickstart' | 'pricing', section: string) => () =>
    trackLandingCtaClicked(name, section);

  return (
    <div className="boop-landing">
      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="wordmark"><span className="dot" />boop</div>
          <div className="nav-links">
            <a href="#you">For you</a>
            <a href="#team">For your team</a>
            <a href="#agents">For your agents</a>
            <a href="#pricing">Pricing</a>
            <Link to="/docs/quickstart" onClick={cta('quickstart', 'nav')}>Docs</Link>
          </div>
          <div className="nav-cta">
            <Link to={appHref} className="btn btn-ghost" onClick={cta('signin', 'nav')}>Sign in</Link>
            <Link to={appHref} className="btn btn-primary" onClick={cta('signup', 'nav')}>Get boop</Link>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="wrap">
          <h1 className="hero-line">
            The todo list your AI agents can use — <em>with receipts.</em>
          </h1>
          <p className="hero-sub">
            One shared space where you, your team, and your agents get things done.
            Realtime, offline-friendly — and every checkmark shows who did it, human or AI.
          </p>
          <div className="hero-cta">
            <Link to={appHref} className="btn btn-primary" onClick={cta('signup', 'hero')}>
              Get boop — free
            </Link>
            <Link to="/docs/quickstart" className="btn btn-ghost" onClick={cta('quickstart', 'hero')}>
              Read the API quickstart →
            </Link>
          </div>
          <p className="hero-signin">
            Already using boop? <Link to={appHref} onClick={cta('signin', 'hero')}>Sign in</Link>
          </p>
          <div className="hero-meta">
            <span className="pip" />
            <span>realtime sync · works offline · receipts included</span>
          </div>

          <AgentDemo />
        </div>
      </section>

      <section className="section" id="paths">
        <div className="wrap">
          <div className="section-label">who it's for</div>
          <h2>One list. Three kinds<br />of <em>doers</em>.</h2>
          <p className="section-lede">
            Most todo apps are built for one person. Some stretch to a team.
            boop is built for the way work actually happens now — you, the people you trust, and the agents working for you.
          </p>

          <div className="paths">
            <div className="path" id="you">
              <div className="path-label">for you</div>
              <h3>Lists that keep up.</h3>
              <p>
                Open boop. Type. Hit return. Your lists sync in realtime across every device,
                work fully offline, and share with the people who matter in two taps.
              </p>
              <ul>
                <li>Realtime sync, everywhere</li>
                <li>Works offline — syncs when you're back</li>
                <li>Keyboard-first on desktop, thumb-first on mobile</li>
              </ul>
              <Link to={appHref} className="btn btn-ghost path-cta" onClick={cta('signup', 'path_you')}>
                Start free
              </Link>
            </div>

            <div className="path" id="team">
              <div className="path-label">for your team</div>
              <h3>One workspace, no chasing.</h3>
              <p>
                Shared lists and workspaces where everyone sees the same thing at the same time.
                Activity history shows who did what and when — no status meetings required.
              </p>
              <ul>
                <li>Shared workspaces and templates</li>
                <li>Assignees, roles, and admin controls</li>
                <li>A full activity trail on every list</li>
              </ul>
              <Link to={appHref} className="btn btn-ghost path-cta" onClick={cta('signup', 'path_team')}>
                Start with your team
              </Link>
            </div>

            <div className="path path-agents" id="agents">
              <div className="path-label">for your agents</div>
              <h3>Mission Control.</h3>
              <p>
                Give your agents a task queue instead of a prompt. They work the same lists you do
                over a simple REST API — you watch items get checked off live, with proof of who did what.
              </p>
              <ul>
                <li>Simple HTTP API — an agent completes a task in 5 minutes with curl</li>
                <li>Watch runs live: working, stalled, or done</li>
                <li>Every agent action signed and attributed</li>
              </ul>
              <Link to="/docs/quickstart" className="btn btn-primary path-cta" onClick={cta('quickstart', 'path_agents')}>
                Read the quickstart →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-tight" id="trust">
        <div className="wrap">
          <div className="trust">
            <div className="trust-grid">
              <div>
                <div className="section-label section-label-dark">trust, not hype</div>
                <h2>Know who did what.<br />Provably.</h2>
                <p>
                  Every action in boop — a human checking off groceries, an agent closing out a release —
                  carries a signature from whoever did it. Nobody can spoof your name,
                  and no agent can quietly rewrite history.
                </p>
                <p>
                  When your agent says the compliance checklist is done, you don't have to take its word for it.
                  The receipts are right there. The cryptography stays behind the curtain — you just see a quiet green dot.
                </p>
              </div>
              <div className="badge-card">
                <div className="who">
                  <span className="avy avy-bot big">⚡</span>
                  <div>
                    <div className="name">
                      release-bot
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                        <path d="M6 1l1.5 1.2 1.8-.1.2 1.8L10.8 5 10 6.5l.8 1.5-1.3 1.1-.2 1.8-1.8-.1L6 11l-1.5-1.2-1.8.1-.2-1.8L1.2 7 2 5.5 1.2 4l1.3-1.1.2-1.8 1.8.1L6 1z" fill="#6b3cff" />
                        <path d="M4 6l1.5 1.5L8 4.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="did">agent · operated by Riley Chen</div>
                  </div>
                </div>
                <div className="badge-note">
                  Checked 4 items on "Ship v0.5" · 2 minutes ago. Riley approved the run.
                </div>
                <span className="signed">
                  <span className="signed-dot" />
                  verified · signature intact
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pullquote">
        <div className="wrap">
          <blockquote>
            "I gave my agent a list instead of a prompt. It checked off four things while I made coffee — and I could see exactly what it did."
          </blockquote>
          <cite>— an early Mission Control tester</cite>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <div className="section-label">pricing</div>
          <h2>Fair, flat, forever.</h2>
          <p className="section-lede">
            Free for solo use, forever. One cheap upgrade for power users, one sane price for teams.
          </p>

          <div className="plans">
            <div className="plan">
              <div className="plan-name">Free</div>
              <div className="plan-desc">For you and your groceries.</div>
              <div className="price">$0<small>/forever</small></div>
              <ul>
                <li>Up to 5 lists</li>
                <li>Up to 3 collaborators per list</li>
                <li>Realtime sync</li>
                <li>Works offline</li>
              </ul>
              <Link to={appHref} className="btn btn-ghost plan-cta" onClick={cta('signup', 'pricing')}>
                Start free
              </Link>
            </div>
            <div className="plan hero-plan">
              <div className="plan-name">Pro</div>
              <div className="plan-desc">For power users.</div>
              <div className="price">$5<small>/month · $48/yr</small></div>
              <ul>
                <li>Unlimited lists and collaborators</li>
                <li>List templates</li>
                <li>Export / backup</li>
                <li>Verified sharing</li>
                <li>Priority sync</li>
              </ul>
              <Link to="/pricing" className="btn btn-primary plan-cta plan-cta-invert" onClick={cta('pricing', 'pricing')}>
                Go Pro
              </Link>
            </div>
            <div className="plan">
              <div className="plan-name">Team</div>
              <div className="plan-desc">For teams — humans and agents.</div>
              <div className="price">$12<small>/user/month</small></div>
              <ul>
                <li>Everything in Pro</li>
                <li>Team workspace + admin controls</li>
                <li>API access for your agents</li>
                <li>Shared templates library</li>
                <li>Priority support</li>
              </ul>
              <Link to="/pricing" className="btn btn-ghost plan-cta" onClick={cta('pricing', 'pricing')}>
                See full pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-tight" id="faq">
        <div className="wrap">
          <div className="section-label">faq</div>
          <h2>Just the honest questions.</h2>

          <div className="faq-grid">
            <div>
              <h3 className="faq-q">How do agents connect?</h3>
              <p className="faq-a">
                Over a plain REST API — create lists, add items, check them off with curl or any HTTP client.
                The <Link to="/docs/quickstart">quickstart</Link> gets an agent completing a task in about five minutes.
              </p>
            </div>
            <div>
              <h3 className="faq-q">Can an agent mess up my lists?</h3>
              <p className="faq-a">
                Agents only touch lists you give them access to, and every action they take is signed and attributed.
                If something looks wrong, the activity trail shows exactly who did what, when.
              </p>
            </div>
            <div>
              <h3 className="faq-q">I don't use AI agents. Is boop still for me?</h3>
              <p className="faq-a">
                Completely. At its heart it's a fast, quiet todo app — realtime, offline, shared with people you trust.
                The agent stuff is there when you want it and invisible when you don't.
              </p>
            </div>
            <div>
              <h3 className="faq-q">What does "with receipts" actually mean?</h3>
              <p className="faq-a">
                Every checkmark carries a signature from whoever made it — a person's device or an agent's key.
                You see a small green dot; auditors and skeptics can verify the rest.
              </p>
            </div>
            <div>
              <h3 className="faq-q">Offline?</h3>
              <p className="faq-a">Works fully offline. Syncs when you reconnect. Your device holds your signing key.</p>
            </div>
            <div>
              <h3 className="faq-q">Do you sell my data?</h3>
              <p className="faq-a">
                No. Your lists are yours; we make money from subscriptions, not from you.
                Shared lists are end-to-end signed, and we're building toward encrypting everything we possibly can.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-wrap">
        <div className="wrap">
          <div className="cta-band">
            <h2>Your next teammate<br />might be an agent.</h2>
            <p>Free for solo use. Five curl commands for your first agent. Nothing to cancel.</p>
            <div className="cta-band-btns">
              <Link to={appHref} className="btn cta-btn" onClick={cta('signup', 'cta_band')}>Get boop</Link>
              <Link to="/docs/quickstart" className="btn cta-btn-ghost" onClick={cta('quickstart', 'cta_band')}>
                API quickstart →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="foot">
            <div className="foot-col foot-col-brand">
              <div className="wordmark wordmark-sm"><span className="dot" />boop</div>
              <div className="foot-tag">Made carefully, by humans and agents.</div>
            </div>
            <div className="foot-col">
              <strong>Product</strong>
              <a href="#paths">Who it's for</a>
              <a href="#pricing">Pricing</a>
              <Link to="/docs/quickstart" onClick={cta('quickstart', 'footer')}>API quickstart</Link>
            </div>
            <div className="foot-col">
              <strong>Trust</strong>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
              <a href="#trust">Security</a>
            </div>
            <div className="foot-col">
              <strong>Company</strong>
              <a href="mailto:hello@boop.ad">Contact</a>
              <Link to={appHref} onClick={cta('signin', 'footer')}>Sign in</Link>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 boop · made in a quiet room</span>
            <span>signed build</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
