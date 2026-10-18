/**
 * Boop marketing landing page.
 *
 * Direction "Seals" (docs/design/DIRECTION.md): every checkmark is a stamp left
 * by whoever made it, round for people and square for agents. The hero list is
 * real and pressable: pressing a box stamps it with the visitor's mark.
 *
 * Sections answer the visitor's questions in order: what is it, who does the
 * work, how do agents connect, can I trust it, what does it cost, what else.
 */

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trackLandingViewed, trackLandingCtaClicked } from '../lib/analytics';
import { Stamp } from '../components/Stamp';

interface HeroItem {
  name: string;
  by: string;
  kind: 'person' | 'agent';
  /** Present when the item starts checked. */
  stamp?: { name: string; time: string; meta: string };
}

const HERO_ITEMS: HeroItem[] = [
  { name: 'Run the test suite on staging', by: 'ci-runner', kind: 'agent', stamp: { name: 'ci-runner', time: '11:20', meta: 'ci-runner · 412 passed · 11:20' } },
  { name: 'Update the App Store screenshots', by: 'Theo', kind: 'person', stamp: { name: 'Theo', time: '13:05', meta: 'Theo · 13:05' } },
  { name: 'Write the release notes', by: 'release-bot', kind: 'agent', stamp: { name: 'release-bot', time: '14:02', meta: 'release-bot, for Ines · 14:02' } },
  { name: 'Email the beta testers', by: 'Ines', kind: 'person' },
  { name: 'Bump the version to 0.5.0', by: 'release-bot', kind: 'agent' },
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

interface SealMove { x: number; y: number; phase: 'travel' | 'press' | 'lift' }

/** The seal object: the visitor's jade stone. On a press it travels to the row and stamps it. */
function Seal({ move, sealRef }: { move: SealMove | null; sealRef: React.RefObject<HTMLDivElement | null> }) {
  const style = move && move.phase !== 'lift'
    ? { transform: `translate(${move.x}px, ${move.y}px) scale(${move.phase === 'press' ? 0.42 : 0.46})` }
    : undefined;
  return (
    <div ref={sealRef} className={`seal${move ? ` is-${move.phase}` : ''}`} style={style} aria-hidden="true">
      <div className="seal-body" />
      <svg className="seal-face" viewBox="0 0 142 142">
        <defs><path id="seal-arc" d="M71 71 m-54 0 a54 54 0 1 1 108 0 a54 54 0 1 1 -108 0" /></defs>
        <circle cx="71" cy="71" r="67" />
        <text><textPath href="#seal-arc" textLength="336" lengthAdjust="spacing">your stamp · press a box · your stamp · press a box ·</textPath></text>
      </svg>
      <span className="seal-glyph">you</span>
    </div>
  );
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function HeroList() {
  // Indices of the open items the visitor has stamped, with the time they did it.
  const [mine, setMine] = useState<Map<number, string>>(new Map());
  const [move, setMove] = useState<SealMove | null>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stamp = (i: number) => setMine(prev => new Map(prev).set(i,
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })));

  const toggle = (i: number) => {
    if (mine.has(i)) {
      setMine(prev => { const next = new Map(prev); next.delete(i); return next; });
      return;
    }
    const seal = sealRef.current?.getBoundingClientRect();
    const slot = slotRefs.current[i]?.getBoundingClientRect();
    if (!seal || !slot || prefersReducedMotion()) { stamp(i); return; }
    // The stone travels from its corner to the row, presses, leaves the mark, and floats back.
    const x = slot.left + slot.width / 2 - (seal.left + seal.width / 2);
    const y = slot.top + slot.height / 2 - (seal.top + seal.height / 2);
    timers.current.forEach(clearTimeout);
    setMove({ x, y, phase: 'travel' });
    timers.current = [
      setTimeout(() => { setMove({ x, y, phase: 'press' }); stamp(i); }, 340),
      setTimeout(() => setMove({ x, y, phase: 'lift' }), 520),
      setTimeout(() => setMove(null), 1000),
    ];
  };

  const done = HERO_ITEMS.filter((item, i) => item.stamp || mine.has(i)).length;

  return (
    <div className="sheet-wrap">
      <div className="sheet" data-wd-float>
        <header className="sheet-head">
          <h2>Ship boop 0.5</h2>
          <p><span className="who">Ines, Theo and release-bot</span><span className="sep" aria-hidden="true"> · </span><span className="count tnum">{done} of {HERO_ITEMS.length} done</span></p>
        </header>
        <ul className="rows">
          {HERO_ITEMS.map((item, i) => {
            const myTime = mine.get(i);
            const checked = !!item.stamp || !!myTime;
            return (
              <li key={item.name} className={`row${checked ? ' is-done' : ''}`}>
                {item.stamp ? (
                  <span className="box is-on" role="img" aria-label="Done"><Check /></span>
                ) : (
                  <button type="button" className={`box${myTime ? ' is-on' : ''}`} aria-pressed={!!myTime}
                    aria-label={`${myTime ? 'Unstamp' : 'Stamp'} "${item.name}"`} onClick={() => toggle(i)}>
                    <Check />
                  </button>
                )}
                <div className="row-text">
                  <span className="row-name">{item.name}</span>
                  <span className="row-meta">{item.stamp ? item.stamp.meta : myTime ? `You · ${myTime}` : item.by}</span>
                </div>
                {item.stamp && <Stamp kind={item.kind} name={item.stamp.name} time={item.stamp.time} className="row-stamp" />}
                {!item.stamp && (
                  <span className="row-stamp" ref={el => { slotRefs.current[i] = el; }}>
                    {myTime && <Stamp kind="person" name="You" time={myTime} fresh />}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Seal move={move} sealRef={sealRef} />
      <p className="sheet-hint">Press a box. Your stamp goes on it.</p>
    </div>
  );
}

const PRICING_ROWS: [string, string, string, string][] = [
  ['Lists', '5', 'Unlimited', 'Unlimited'],
  ['Collaborators per list', '3', 'Unlimited', 'Unlimited'],
  ['Realtime sync, works offline', 'yes', 'yes', 'yes'],
  ['Templates, export, verified sharing', '', 'yes', 'yes'],
  ['Team workspace and admin controls', '', '', 'yes'],
  ['API access for your agents', '', '', 'yes'],
];

function Cell({ value }: { value: string }) {
  if (value === 'yes') return <span className="yes" role="img" aria-label="Included"><Check /></span>;
  if (value === '') return <span className="no" aria-label="Not included">–</span>;
  return <>{value}</>;
}

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
      <nav className="nav" aria-label="Main">
        <Link to="/" className="boop-wordmark nav-mark"><span className="boop-dot" aria-hidden="true" />boop</Link>
        <div className="nav-links">
          <a href="#work">How it works</a>
          <a href="#agents">Agents</a>
          <a href="#pricing">Pricing</a>
          <Link to="/docs/quickstart" onClick={cta('quickstart', 'nav')}>Docs</Link>
        </div>
        <div className="nav-cta">
          <Link to={appHref} className="nav-signin" onClick={cta('signin', 'nav')}>Sign in</Link>
          <Link to={appHref} className="btn" onClick={cta('signup', 'nav')}>Get boop</Link>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Every checkmark <span className="h1-indent">says who made it.</span></h1>
            <p className="hero-sub">
              A shared todo list for <b>you, your team and your AI agents.</b> Each tick is stamped
              and signed by the person or agent behind it.
            </p>
            <div className="hero-cta">
              <Link to={appHref} className="btn btn-lg" onClick={cta('signup', 'hero')}>Start a list, free <Arrow /></Link>
              <p className="hero-signin">Already using boop? <Link to={appHref} onClick={cta('signin', 'hero')}>Sign in</Link></p>
            </div>
          </div>
          <HeroList />
        </section>

        <section className="work" id="work">
          <div className="work-intro">
            <h2>One list, whoever does the work.</h2>
            <p>People check things off from their phone. Agents check them off over the API. Everyone's tick looks different, so you always know which was which.</p>
          </div>
          <div className="rail">
            <article className="actor" id="you">
              <Stamp name="You" time="09:41" size={132} />
              <h3>Lists that keep up.</h3>
              <p>Type, hit return, done. Syncs live across your devices and keeps working offline.</p>
              <p className="actor-did"><b>Pick up the cake</b>{'\u00a0'}· from the bus, 09:41</p>
            </article>
            <article className="actor" id="team">
              <Stamp name="Theo" time="13:05" size={132} />
              <h3>One workspace, no chasing.</h3>
              <p>Share a list in two taps. Everyone sees the same list at the same moment, with a history of who did what.</p>
              <p className="actor-did"><b>Update the App Store screenshots</b>{'\u00a0'}·{'\u00a0'}13:05</p>
            </article>
            <article className="actor actor-agent">
              <Stamp kind="agent" name="release-bot" time="14:02" size={132} />
              <h3>Hand an agent the list.</h3>
              <p>Give an agent a list instead of a prompt. You watch items close live, and each one carries the agent's stamp.</p>
              <p className="actor-did"><b>Write the release notes</b>{'\u00a0'}· for Ines, 14:02</p>
            </article>
          </div>
          <p className="rail-key">
            <span className="key"><span className="key-round" aria-hidden="true" />Round is a person.</span>
            <span className="key"><span className="key-square" aria-hidden="true" />Square is an agent.</span>
          </p>
        </section>

        <section className="agents" id="agents">
          <div className="agents-copy">
            <h2>An agent finishes its first task in five minutes.</h2>
            <p>Create an API key, hand it to your agent, and it works the same lists you do with any HTTP client. No SDK to install.</p>
            <Link to="/docs/quickstart" className="text-link" onClick={cta('quickstart', 'agents')}>Read the API quickstart <Arrow /></Link>
          </div>
          <div className="agents-demo">
            <pre className="code" aria-label="Example request"><code>
<span className="c-dim">$</span> curl -X POST \{'\n'}
{'  '}https://boop.ad/api/items/check \{'\n'}
{'  '}-H <span className="c-str">"Authorization: Bearer $BOOP_KEY"</span> \{'\n'}
{'  '}-d <span className="c-str">'{'{'}"itemId":"k7c2r9","checked":true{'}'}'</span>{'\n\n'}
<span className="c-ok">200</span> <span className="c-dim">checked · signed by release-bot</span>
            </code></pre>
            <div className="result" data-wd-float>
              <span className="box is-on" role="img" aria-label="Done"><Check /></span>
              <div className="row-text"><span className="row-name">Bump the version to 0.5.0</span><span className="row-meta">release-bot · just now</span></div>
              <Stamp kind="agent" name="release-bot" time="now" size={64} />
            </div>
          </div>
        </section>

        <section className="record" id="trust">
          <div className="record-inner">
            <div className="record-seal" aria-hidden="true" data-wd-float><Stamp kind="agent" name="release-bot" time="14:02" size={220} /></div>
            <div className="record-copy">
              <h2>Tap any stamp to read its record.</h2>
              <dl>
                <div><dt>Item</dt><dd>Write the release notes</dd></div>
                <div><dt>Checked</dt><dd className="tnum">Tue 14 Oct, 14:02:31</dd></div>
                <div><dt>By</dt><dd>release-bot, using the API key Ines Moreau issued it</dd></div>
                <div><dt>Signed</dt><dd>with release-bot's key, on list Ship boop 0.5</dd></div>
              </dl>
              <p>No one can put your name on a tick you didn't make, and no agent can quietly rewrite what it did.</p>
            </div>
          </div>
        </section>

        <section className="pricing" id="pricing">
          <h2>$0 for you. $12 for a team.</h2>
          <p className="pricing-lede">Five lists free, forever. Pro is $5 a month when you need more.</p>
          <div className="table-scroll">
            <table className="plans">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Feature</span></th>
                  <th scope="col"><span className="plan-name">Free</span><span className="plan-price">$0</span><span className="plan-per">forever</span></th>
                  <th scope="col" className="is-pro"><span className="plan-name">Pro</span><span className="plan-price">$5</span><span className="plan-per">a month, or $48 a year</span></th>
                  <th scope="col"><span className="plan-name">Team</span><span className="plan-price">$12</span><span className="plan-per">per person, a month</span></th>
                </tr>
              </thead>
              <tbody>
                {PRICING_ROWS.map(([label, free, pro, team]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td><Cell value={free} /></td>
                    <td className="is-pro"><Cell value={pro} /></td>
                    <td><Cell value={team} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td><Link to={appHref} className="btn btn-quiet" onClick={cta('signup', 'pricing')}>Start free</Link></td>
                  <td className="is-pro"><Link to="/pricing" className="btn" onClick={cta('pricing', 'pricing')}>Go Pro</Link></td>
                  <td><Link to="/pricing" className="btn btn-quiet" onClick={cta('pricing', 'pricing')}>See full pricing</Link></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="plans-stack">
            {([
              ['Free', '$0', 'forever', 1, <Link key="f" to={appHref} className="btn btn-quiet" onClick={cta('signup', 'pricing')}>Start free</Link>],
              ['Pro', '$5', 'a month, or $48 a year', 2, <Link key="p" to="/pricing" className="btn" onClick={cta('pricing', 'pricing')}>Go Pro</Link>],
              ['Team', '$12', 'per person, a month', 3, <Link key="t" to="/pricing" className="btn btn-quiet" onClick={cta('pricing', 'pricing')}>See full pricing</Link>],
            ] as const).map(([name, price, per, col, action]) => (
              <div key={name} className={`plan-block${name === 'Pro' ? ' is-pro' : ''}`}>
                <span className="plan-name">{name}</span>
                <span className="plan-price">{price}</span>
                <span className="plan-per">{per}</span>
                <ul>
                  {PRICING_ROWS.filter(row => row[col] !== '').map(row => (
                    <li key={row[0]}>
                      <span className="yes" aria-hidden="true"><Check /></span>
                      {row[col] === 'yes' ? row[0] : `${row[0]}: ${row[col]}`}
                    </li>
                  ))}
                </ul>
                {action}
              </div>
            ))}
          </div>
        </section>

        <section className="faq" id="faq">
          <h2>Before you sign up.</h2>
          <div className="faq-grid">
            <div>
              <h3>How do agents connect?</h3>
              <p>Over a plain REST API. Create lists, add items and check them off with curl or any HTTP client. The <Link to="/docs/quickstart">quickstart</Link> gets an agent completing a task in about five minutes.</p>
            </div>
            <div>
              <h3>Can an agent mess up my lists?</h3>
              <p>Agents only touch the lists you give them access to, and every action they take is signed and attributed. If something looks wrong, the history shows who did what, and when.</p>
            </div>
            <div>
              <h3>I don't use AI agents. Is boop still for me?</h3>
              <p>Completely. At heart it's a fast, quiet todo app: realtime, offline, shared with people you trust. The agent side is there when you want it and invisible when you don't.</p>
            </div>
            <div>
              <h3>What does a stamp actually prove?</h3>
              <p>Every checkmark is signed by whoever made it, a person's device or an agent's key. You see the stamp; anyone sceptical can verify the signature.</p>
            </div>
            <div>
              <h3>Does it work offline?</h3>
              <p>Yes. Lists keep working without a connection and sync when you're back. Your device holds your signing key.</p>
            </div>
            <div>
              <h3>Do you sell my data?</h3>
              <p>No. Your lists are yours; we make money from subscriptions, not from you. Shared lists are signed end to end, and we're working toward encrypting everything we can.</p>
            </div>
          </div>
        </section>

        <section className="end">
          <h2>
            Your next teammate might be an{' '}
            <span className="end-word">agent.<span className="end-stamp" aria-hidden="true" data-wd-float><Stamp name="You" time="now" size={340} /></span></span>
          </h2>
          <p>Free for solo use. Nothing to cancel.</p>
          <div className="end-cta">
            <Link to={appHref} className="btn btn-lg" onClick={cta('signup', 'cta_band')}>Start a list, free <Arrow /></Link>
            <Link to="/docs/quickstart" className="text-link" onClick={cta('quickstart', 'cta_band')}>API quickstart <Arrow /></Link>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="foot-brand">
          <span className="boop-wordmark"><span className="boop-dot" aria-hidden="true" />boop</span>
          <p>Made carefully, by humans and agents.</p>
        </div>
        <nav className="foot-links" aria-label="Footer">
          <a href="#work">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link to="/docs/quickstart" onClick={cta('quickstart', 'footer')}>API quickstart</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href="mailto:hello@boop.ad">Contact</a>
          <Link to={appHref} onClick={cta('signin', 'footer')}>Sign in</Link>
        </nav>
        <p className="foot-small">© 2026 boop</p>
      </footer>
    </div>
  );
}
