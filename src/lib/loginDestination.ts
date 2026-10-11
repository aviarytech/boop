import { templateLoginDestination } from '../../convex/lib/templateCatalog';

/** Resume a guarded route without accepting external URLs or login loops. */
export function loginDestination(search: string, state: unknown): { to: string; state?: unknown } {
  const template = templateLoginDestination(search);
  if (template !== '/d') return { to: template };

  const from = state && typeof state === 'object' && 'from' in state ? state.from : null;
  if (!from || typeof from !== 'object' || !('pathname' in from)) return { to: '/d' };
  const pathname = from.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//') ||
      /[\\?#]/.test(pathname) || [...pathname].some(character => character.charCodeAt(0) <= 32)) return { to: '/d' };
  const target = new URL(pathname, 'https://boop.invalid');
  if (target.origin !== 'https://boop.invalid' || target.pathname.startsWith('//') ||
      /^\/login\/*$/i.test(target.pathname)) return { to: '/d' };

  const query = 'search' in from && typeof from.search === 'string' && from.search.startsWith('?') ? from.search : '';
  const hash = 'hash' in from && typeof from.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return {
    to: `${target.pathname}${query}${hash}`,
    state: 'state' in from ? from.state : undefined,
  };
}
