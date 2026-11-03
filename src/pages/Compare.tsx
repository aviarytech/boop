import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { PublicHeader, publicNavButton, publicNavLink } from '../components/PublicHeader'
import { Icon } from '../components/ui/Icon'

type Feature = {
  name: string
  boop: string | boolean
  competitor: string | boolean
}

type CompetitorData = {
  name: string
  slug: string
  tagline: string
  metaTitle: string
  metaDescription: string
  ogDescription: string
  boopHeadline: string
  competitorHeadline: string
  features: Feature[]
  competitorWeakness: string
  ctaSubtext: string
}

const COMPETITORS: Record<string, CompetitorData> = {
  todoist: {
    name: 'Todoist',
    slug: 'todoist',
    tagline: 'boop vs Todoist',
    metaTitle: 'boop vs Todoist — The Better Todoist Alternative',
    metaDescription:
      'Comparing boop vs Todoist: offline-first access, real-time collaboration, DID-signed data ownership, and a free tier that actually works. See why teams are switching.',
    ogDescription:
      'boop vs Todoist — offline-first, real-time sync, and data you actually own. Free to start.',
    boopHeadline: 'Offline-first. Data you own. Free to start.',
    competitorHeadline: 'Todoist requires a connection and a credit card for collaboration.',
    features: [
      { name: 'Real-time sync', boop: true, competitor: true },
      { name: 'Offline access', boop: '✅ Full offline — works without internet', competitor: '⚠️ Limited offline mode (premium only)' },
      { name: 'List sharing / collaboration', boop: '✅ Free', competitor: '⚠️ Requires paid plan' },
      { name: 'Free tier list limit', boop: '5 lists free', competitor: '5 active projects free' },
      { name: 'Pricing (paid)', boop: 'From $5/mo', competitor: 'From $4/mo' },
      { name: 'iOS', boop: true, competitor: true },
      { name: 'Android', boop: true, competitor: true },
      { name: 'Web app', boop: true, competitor: true },
      { name: 'Mac app', boop: '✅ PWA', competitor: true },
      { name: 'Windows / Linux', boop: '✅ Web / PWA', competitor: true },
      { name: 'DID-signed data ownership', boop: '✅ Your data, cryptographically yours', competitor: '❌ Vendor lock-in' },
      { name: 'Open data export', boop: true, competitor: '⚠️ CSV only (paid)' },
    ],
    competitorWeakness:
      'Todoist is powerful but designed for power users who want lots of setup. Collaboration is paywalled, offline is an afterthought, and your data is locked in their servers.',
    ctaSubtext: 'No credit card required. 5 lists free forever.',
  },
  reminders: {
    name: 'Apple Reminders',
    slug: 'reminders',
    tagline: 'boop vs Apple Reminders',
    metaTitle: 'boop vs Apple Reminders — Better Cross-Platform Todo App',
    metaDescription:
      'Comparing boop vs Apple Reminders: real-time sync across all platforms, full offline support, and list sharing without an Apple device. Free to start.',
    ogDescription:
      'boop vs Apple Reminders — works on Android, Windows, and web. Real-time sync. Free.',
    boopHeadline: 'Cross-platform. Real-time. No Apple required.',
    competitorHeadline: 'Apple Reminders only works if everyone you share with owns Apple devices.',
    features: [
      { name: 'Real-time sync', boop: true, competitor: '⚠️ iCloud only — can lag' },
      { name: 'Offline access', boop: true, competitor: true },
      { name: 'List sharing / collaboration', boop: '✅ Any platform', competitor: '⚠️ Apple devices only' },
      { name: 'Free tier', boop: '5 lists free, always', competitor: '✅ Free (with iCloud)' },
      { name: 'Pricing (paid)', boop: 'From $5/mo', competitor: 'Free (iCloud storage separate)' },
      { name: 'iOS', boop: true, competitor: true },
      { name: 'Android', boop: true, competitor: '❌ Not available' },
      { name: 'Web app', boop: true, competitor: '⚠️ iCloud.com only (limited)' },
      { name: 'Mac app', boop: '✅ PWA', competitor: true },
      { name: 'Windows / Linux', boop: '✅ Web / PWA', competitor: '❌ Not available' },
      { name: 'DID-signed data ownership', boop: '✅ Your data, cryptographically yours', competitor: '❌ Apple owns your data' },
      { name: 'Real-time collaborative editing', boop: true, competitor: '❌ No live collaboration' },
    ],
    competitorWeakness:
      "Apple Reminders is free and well-integrated on Apple devices, but falls apart the moment you need to collaborate with someone on Android or Windows. There's no real web app and no real-time sync.",
    ctaSubtext: 'Works on every platform. No Apple ID required.',
  },
  things: {
    name: 'Things 3',
    slug: 'things',
    tagline: 'boop vs Things 3',
    metaTitle: 'boop vs Things 3 — Free Alternative with Real-Time Sharing',
    metaDescription:
      'Comparing boop vs Things 3: free to start, real-time collaboration, cross-platform, and no $50 Mac app purchase. See why boop is the modern Things alternative.',
    ogDescription:
      'boop vs Things 3 — free to start, real-time sharing, works on Android and web. No $50 upfront.',
    boopHeadline: 'Free to start. Real-time. Works everywhere.',
    competitorHeadline: 'Things 3 costs $50 for Mac, has no Android app, and has zero collaboration.',
    features: [
      { name: 'Real-time sync', boop: true, competitor: '⚠️ Things Cloud (no collaboration)' },
      { name: 'Offline access', boop: true, competitor: true },
      { name: 'List sharing / collaboration', boop: '✅ Real-time', competitor: '❌ No sharing at all' },
      { name: 'Free tier', boop: '5 lists free, always', competitor: '❌ No free tier — one-time purchase' },
      { name: 'Pricing', boop: 'Free + $5/mo Pro', competitor: '$9.99 iOS + $49.99 Mac + $19.99 iPad' },
      { name: 'iOS', boop: true, competitor: true },
      { name: 'Android', boop: true, competitor: '❌ Not available' },
      { name: 'Web app', boop: true, competitor: '❌ Not available' },
      { name: 'Mac app', boop: '✅ PWA', competitor: '✅ Native (paid separately)' },
      { name: 'Windows / Linux', boop: '✅ Web / PWA', competitor: '❌ Not available' },
      { name: 'DID-signed data ownership', boop: '✅ Your data, cryptographically yours', competitor: '❌ Vendor lock-in' },
      { name: 'Real-time collaborative editing', boop: true, competitor: '❌ Solo use only' },
    ],
    competitorWeakness:
      'Things 3 is a beautiful, polished app for solo productivity on Apple devices. But it has zero sharing, no Android or web app, and charges $50+ just for Mac access. Not built for teams or modern cross-platform life.',
    ctaSubtext: 'Free to start. No $50 upfront. Works on every device.',
  },
}

// Cells in the data lead with a status emoji (✅ ⚠️ ❌); draw it as a glyph
// in the page's ink instead, and keep the words.
const STATUS = [
  { mark: '✅', icon: 'check', tone: 'text-[var(--boop-accent)]', label: 'Yes' },
  { mark: '⚠️', icon: 'alert', tone: 'text-[var(--boop-dim)]', label: 'Partly' },
  { mark: '❌', icon: 'x', tone: 'text-[var(--boop-dim)]', label: 'No' },
] as const

function FeatureCell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    const status = STATUS[value ? 0 : 2]
    return <span className={`inline-flex ${status.tone}`}><Icon name={status.icon} className="w-5 h-5" /><span className="sr-only">{status.label}</span></span>
  }
  const status = STATUS.find(st => value.startsWith(st.mark))
  const text = status ? value.slice(status.mark.length).trim() : value
  return (
    <span className="flex flex-col items-center gap-1 text-sm text-[var(--boop-ink)] [overflow-wrap:anywhere] sm:flex-row sm:items-start sm:justify-center sm:gap-1.5">
      {status && <Icon name={status.icon} className={`w-4 h-4 sm:mt-0.5 ${status.tone}`} />}
      <span className="[hyphens:auto]" lang="en">{text}</span>
    </span>
  )
}

export function Compare() {
  const { competitor } = useParams<{ competitor: string }>()
  const data = COMPETITORS[competitor ?? '']

  useEffect(() => {
    document.body.classList.add('scrollable-page');
    return () => document.body.classList.remove('scrollable-page');
  }, []);

  useEffect(() => {
    if (!data) return
    document.title = data.metaTitle

    const setMeta = (selector: string, content: string, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${selector}"]`) as HTMLMetaElement | null
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, selector)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }

    setMeta('description', data.metaDescription)
    setMeta('og:title', data.metaTitle, 'property')
    setMeta('og:description', data.ogDescription, 'property')
    setMeta('og:type', 'website', 'property')
    setMeta('twitter:title', data.metaTitle)
    setMeta('twitter:description', data.ogDescription)

    return () => {
      document.title = 'boop'
    }
  }, [data])

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--boop-bg)]">
        <PublicHeader />
        <main className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <h1 className="mb-3 text-2xl font-bold text-[var(--boop-ink)]">Comparison not found</h1>
          <a href="/" className="font-semibold text-[var(--boop-accent)] underline underline-offset-4">Back to boop</a>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--boop-bg)] text-[var(--boop-ink)]">
      <PublicHeader>
        <a href="/" className={`${publicNavLink} hidden sm:inline`}>&larr; Back to boop</a>
        <a href="/pricing" className={publicNavLink}>Pricing</a>
        <a href="/" className={publicNavButton}>Try boop Free</a>
      </PublicHeader>

      <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="mb-10">
          <h1 className="mb-3 text-[clamp(36px,6vw,56px)] font-extrabold leading-[1.02] tracking-[-0.03em]">{data.tagline}</h1>
          <p className="max-w-2xl text-xl text-[var(--boop-muted)]">{data.boopHeadline}</p>
        </header>

        {/* Intro blurb */}
        <section className="mb-12">
          <p className="mb-3 text-lg leading-relaxed text-[var(--boop-muted)]">{data.competitorWeakness}</p>
          <p className="font-semibold text-[var(--boop-accent-ink)]">{data.competitorHeadline}</p>
        </section>

        {/* Comparison table */}
        <section className="mb-14">
          <h2 className="mb-4 text-2xl font-bold">Feature Comparison</h2>
          <div className="boop-sheet overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-[var(--boop-line)] text-[var(--boop-muted)]">
                  <th className="w-[40%] px-3 sm:px-4 py-3 text-left font-semibold">Feature</th>
                  <th className="w-[30%] px-3 sm:px-4 py-3 text-center font-semibold text-[var(--boop-ink)]">
                    <span className="boop-wordmark justify-center text-[15px]"><span className="boop-dot" aria-hidden="true" />boop</span>
                  </th>
                  <th className="w-[30%] px-3 sm:px-4 py-3 text-center font-semibold">{data.name}</th>
                </tr>
              </thead>
              <tbody>
                {data.features.map((feature) => (
                  <tr key={feature.name} className="border-b border-[var(--boop-line)] last:border-0">
                    <td className="px-3 sm:px-4 py-3 font-medium">{feature.name}</td>
                    <td className="px-3 sm:px-4 py-3 text-center">
                      <FeatureCell value={feature.boop} />
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-center">
                      <FeatureCell value={feature.competitor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-[22px] bg-[var(--boop-accent-soft)] px-6 py-12 text-center sm:px-8">
          <h2 className="mb-3 text-2xl font-extrabold tracking-[-0.02em] md:text-3xl">
            Ready to ditch {data.name}?
          </h2>
          <p className="mx-auto mb-6 max-w-xl text-lg text-[var(--boop-muted)]">
            {data.ctaSubtext}
          </p>
          <a href="/" className={`${publicNavButton} px-7 py-3 text-lg`}>
            Try boop Free
          </a>
          <p className="mt-4 text-sm text-[var(--boop-muted)]">
            Free forever for up to 5 lists. No credit card needed.
          </p>
        </section>

        {/* Other comparisons */}
        <section className="mt-12">
          <h3 className="mb-4 text-lg font-bold">More comparisons</h3>
          <div className="flex flex-wrap gap-3">
            {Object.values(COMPETITORS)
              .filter(c => c.slug !== data.slug)
              .map(c => (
                <a
                  key={c.slug}
                  href={`/compare/${c.slug}`}
                  className="rounded-xl border border-[var(--boop-line)] bg-[var(--boop-card)] px-4 py-2 text-sm font-semibold transition-colors hover:border-[var(--boop-accent)]"
                >
                  boop vs {c.name} &rarr;
                </a>
              ))}
          </div>
        </section>
      </main>

      <footer className="mt-4 border-t border-[var(--boop-line)] px-4 py-6 text-center text-sm text-[var(--boop-muted)]">
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a href="/" className="boop-wordmark hover:opacity-80 transition-opacity" aria-label="boop">
            <span className="boop-dot" aria-hidden="true" />
            <span>boop</span>
          </a>
          <span aria-hidden="true">·</span>
          <a href="/pricing" className="hover:text-[var(--boop-ink)] transition-colors">Pricing</a>
          <span aria-hidden="true">·</span>
          <a href="/privacy" className="hover:text-[var(--boop-ink)] transition-colors">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms" className="hover:text-[var(--boop-ink)] transition-colors">Terms</a>
        </p>
      </footer>
    </div>
  )
}
