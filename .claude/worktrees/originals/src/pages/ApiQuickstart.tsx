/**
 * Mission Control API quickstart — "an agent completing a task in 5 minutes
 * with curl" (docs/business-plan.md §7 Phase 0).
 *
 * Every endpoint shown here exists today in convex/http.ts; keep the examples
 * in sync with those handlers.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trackQuickstartViewed, trackLandingCtaClicked } from '../lib/analytics';
import './ApiQuickstart.css';

const API_BASE =
  (import.meta.env.VITE_CONVEX_HTTP_URL as string | undefined) ??
  'https://your-deployment.convex.site';

function Code({ children }: { children: string }) {
  return (
    <pre className="qs-code">
      <code>{children}</code>
    </pre>
  );
}

export function ApiQuickstart() {
  const { isAuthenticated } = useAuth();
  const appHref = isAuthenticated ? '/' : '/login';

  useEffect(() => {
    document.body.classList.add('scrollable-page');
    trackQuickstartViewed();
    return () => document.body.classList.remove('scrollable-page');
  }, []);

  return (
    <div className="boop-quickstart">
      <nav className="qs-nav">
        <div className="qs-wrap qs-nav-inner">
          <Link to="/" className="qs-wordmark"><span className="qs-dot" />boop</Link>
          <Link
            to={appHref}
            className="qs-btn"
            onClick={() => trackLandingCtaClicked('signup', 'quickstart_nav')}
          >
            Get boop — free
          </Link>
        </div>
      </nav>

      <main className="qs-wrap qs-main">
        <div className="qs-label">boop mission control</div>
        <h1>An agent completing a task in 5 minutes, with curl.</h1>
        <p className="qs-lede">
          boop's API is plain HTTP + JSON. Your agent authenticates once, then works the same lists
          you see in the app — every change shows up in realtime, attributed to whoever made it.
        </p>

        <section>
          <h2>0 · Grab a list</h2>
          <p>
            <Link to={appHref}>Sign up</Link> (free), create a list, and open it. The list ID is the
            last segment of the URL:
          </p>
          <Code>{`https://boop.ad/list/js77strp35s0br8deqf30bvrxh80pm4t
                   └────────────── listId ──────────────┘`}</Code>
        </section>

        <section>
          <h2>1 · Get a token</h2>
          <p>
            Auth is a two-step email code. Request a code, read it from your inbox, trade it for a
            JWT. The token is good for 30 days — store it wherever your agent keeps secrets.
          </p>
          <Code>{`# request a one-time code (arrives by email)
curl -X POST ${API_BASE}/auth/initiate \\
  -H 'Content-Type: application/json' \\
  -d '{"email": "agent@yourdomain.com"}'
# → {"sessionId": "…", "message": "Code sent"}

# trade the code for a 30-day token
curl -X POST ${API_BASE}/auth/verify \\
  -H 'Content-Type: application/json' \\
  -d '{"sessionId": "<sessionId>", "code": "<code-from-email>"}'
# → {"token": "eyJ…", "user": {…}}

export BOOP_TOKEN="eyJ…"`}</Code>
        </section>

        <section>
          <h2>2 · Add an item</h2>
          <Code>{`curl -X POST ${API_BASE}/api/items/add \\
  -H "Authorization: Bearer $BOOP_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"listId": "<listId>", "name": "Draft release notes"}'
# → {"itemId": "…"}`}</Code>
          <p className="qs-note">
            Keep the app open next to your terminal — the item appears in the list the moment the
            request lands. That's the realtime sync your agent gets for free.
          </p>
        </section>

        <section>
          <h2>3 · Check it off</h2>
          <Code>{`curl -X POST ${API_BASE}/api/items/check \\
  -H "Authorization: Bearer $BOOP_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"itemId": "<itemId>"}'
# → {"success": true}`}</Code>
          <p className="qs-note">
            The checkmark is recorded against your agent's identity and signed — anyone on the list
            can see (and verify) that the agent did it, and when.
          </p>
        </section>

        <section>
          <h2>4 · See what happened</h2>
          <p>Pull the activity trail for the list — every add, check, and edit, attributed:</p>
          <Code>{`curl -X POST ${API_BASE}/api/activity/list \\
  -H "Authorization: Bearer $BOOP_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"listId": "<listId>"}'`}</Code>
        </section>

        <section>
          <h2>Endpoint reference</h2>
          <table className="qs-table">
            <thead>
              <tr><th>Endpoint</th><th>Body</th><th>Does</th></tr>
            </thead>
            <tbody>
              <tr><td><code>POST /api/items/add</code></td><td><code>{'{listId, name}'}</code></td><td>Add an item</td></tr>
              <tr><td><code>POST /api/items/check</code></td><td><code>{'{itemId}'}</code></td><td>Complete an item</td></tr>
              <tr><td><code>POST /api/items/uncheck</code></td><td><code>{'{itemId}'}</code></td><td>Reopen an item</td></tr>
              <tr><td><code>POST /api/items/remove</code></td><td><code>{'{itemId}'}</code></td><td>Delete an item</td></tr>
              <tr><td><code>POST /api/lists/delete</code></td><td><code>{'{listId}'}</code></td><td>Delete a list</td></tr>
              <tr><td><code>POST /api/assignees/assign</code></td><td><code>{'{itemId, assigneeDid}'}</code></td><td>Assign an item</td></tr>
              <tr><td><code>POST /api/activity/list</code></td><td><code>{'{listId}'}</code></td><td>Attributed activity trail</td></tr>
              <tr><td><code>POST /api/presence/heartbeat</code></td><td><code>{'{listId}'}</code></td><td>Show the agent as active on a list</td></tr>
            </tbody>
          </table>
          <p className="qs-note">
            All endpoints take <code>Authorization: Bearer &lt;token&gt;</code> and JSON bodies.
            An OpenAPI spec and MCP server are on the roadmap — this page will link them when they ship.
          </p>
        </section>

        <div className="qs-cta">
          <h2>Give your agent a list.</h2>
          <p>Free to start. Your first agent run is five curl commands away.</p>
          <Link
            to={appHref}
            className="qs-btn qs-btn-lg"
            onClick={() => trackLandingCtaClicked('signup', 'quickstart_footer')}
          >
            Get boop — free
          </Link>
        </div>
      </main>

      <footer className="qs-foot">
        <div className="qs-wrap">
          <span>© 2026 boop</span>
          <span><Link to="/">Home</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link></span>
        </div>
      </footer>
    </div>
  );
}
