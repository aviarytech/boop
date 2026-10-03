import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

type Feature = {
  name: string
  poo: string | boolean
  competitor: string | boolean
}

type CompetitorData = {
  name: string
  slug: string
  tagline: string
  metaTitle: string
  metaDescription: string
  ogDescription: string
  pooHeadline: string
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
    pooHeadline: 'Offline-first. Data you own. Free to start.',
    competitorHeadline: 'Todoist requires a connection and a credit card for collaboration.',
    features: [
      { name: 'Real-time sync', poo: true, competitor: true },
      { name: 'Offline access', poo: '✅ Full offline — works without internet', competitor: '⚠️ Limited offline mode (premium only)' },
      { name: 'List sharing / collaboration', poo: '✅ Free', competitor: '⚠️ Requires paid plan' },
      { name: 'Free tier list limit', poo: '5 lists free', competitor: '5 active projects free' },
      { name: 'Pricing (paid)', poo: 'From $3/mo', competitor: 'From $4/mo' },
      { name: 'iOS', poo: true, competitor: true },
      { name: 'Android', poo: true, competitor: true },
      { name: 'Web app', poo: true, competitor: true },
      { name: 'Mac app', poo: '✅ PWA', competitor: true },
      { name: 'Windows / Linux', poo: '✅ Web / PWA', competitor: true },
      { name: 'DID-signed data ownership', poo: '✅ Your data, cryptographically yours', competitor: '❌ Vendor lock-in' },
      { name: 'Open data export', poo: true, competitor: '⚠️ CSV only (paid)' },
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
    pooHeadline: 'Cross-platform. Real-time. No Apple required.',
    competitorHeadline: 'Apple Reminders only works if everyone you share with owns Apple devices.',
    features: [
      { name: 'Real-time sync', poo: true, competitor: '⚠️ iCloud only — can lag' },
      { name: 'Offline access', poo: true, competitor: true },
      { name: 'List sharing / collaboration', poo: '✅ Any platform', competitor: '⚠️ Apple devices only' },
      { name: 'Free tier', poo: '5 lists free, always', competitor: '✅ Free (with iCloud)' },
      { name: 'Pricing (paid)', poo: 'From $3/mo', competitor: 'Free (iCloud storage separate)' },
      { name: 'iOS', poo: true, competitor: true },
      { name: 'Android', poo: true, competitor: '❌ Not available' },
      { name: 'Web app', poo: true, competitor: '⚠️ iCloud.com only (limited)' },
      { name: 'Mac app', poo: '✅ PWA', competitor: true },
      { name: 'Windows / Linux', poo: '✅ Web / PWA', competitor: '❌ Not available' },
      { name: 'DID-signed data ownership', poo: '✅ Your data, cryptographically yours', competitor: '❌ Apple owns your data' },
      { name: 'Real-time collaborative editing', poo: true, competitor: '❌ No live collaboration' },
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
    pooHeadline: 'Free to start. Real-time. Works everywhere.',
    competitorHeadline: 'Things 3 costs $50 for Mac, has no Android app, and has zero collaboration.',
    features: [
      { name: 'Real-time sync', poo: true, competitor: '⚠️ Things Cloud (no collaboration)' },
      { name: 'Offline access', poo: true, competitor: true },
      { name: 'List sharing / collaboration', poo: '✅ Real-time', competitor: '❌ No sharing at all' },
      { name: 'Free tier', poo: '5 lists free, always', competitor: '❌ No free tier — one-time purchase' },
      { name: 'Pricing', poo: 'Free + $3/mo Pro', competitor: '$9.99 iOS + $49.99 Mac + $19.99 iPad' },
      { name: 'iOS', poo: true, competitor: true },
      { name: 'Android', poo: true, competitor: '❌ Not available' },
      { name: 'Web app', poo: true, competitor: '❌ Not available' },
      { name: 'Mac app', poo: '✅ PWA', competitor: '✅ Native (paid separately)' },
      { name: 'Windows / Linux', poo: '✅ Web / PWA', competitor: '❌ Not available' },
      { name: 'DID-signed data ownership', poo: '✅ Your data, cryptographically yours', competitor: '❌ Vendor lock-in' },
      { name: 'Real-time collaborative editing', poo: true, competitor: '❌ Solo use only' },
    ],
    competitorWeakness:
      'Things 3 is a beautiful, polished app for solo productivity on Apple devices. But it has zero sharing, no Android or web app, and charges $50+ just for Mac access. Not built for teams or modern cross-platform life.',
    ctaSubtext: 'Free to start. No $50 upfront. Works on every device.',
  },
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-amber-600 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-5 h-5 text-gray-400 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function FeatureCell({ value }: { value: string | boolean }) {
  if (value === true) return <span><CheckIcon /></span>
  if (value === false) return <span><XIcon /></span>
  return <span className="text-sm text-gray-700">{value}</span>
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
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div
            className="mx-auto mb-5 rounded-full"
            style={{ width: 48, height: 48, background: 'var(--boop-accent)' }}
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold text-amber-900 mb-2">Comparison not found</h1>
          <a href="/" className="text-amber-600 underline">Back to boop</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-amber-900 text-amber-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <a href="/" className="flex items-center gap-2 mb-6 text-amber-200 hover:text-white transition-colors text-sm">
            &larr; Back to boop
          </a>
          <div className="flex items-center gap-3 mb-3">
            <span
              className="rounded-full"
              style={{ width: 28, height: 28, background: 'var(--boop-accent)', display: 'inline-block' }}
              aria-hidden="true"
            />
            <h1 className="text-3xl md:text-4xl font-black">{data.tagline}</h1>
          </div>
          <p className="text-amber-200 text-lg max-w-2xl">{data.pooHeadline}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* Intro blurb */}
        <section className="mb-10">
          <p className="text-amber-800 text-lg leading-relaxed mb-2">{data.competitorWeakness}</p>
          <p className="text-amber-700 font-semibold">{data.competitorHeadline}</p>
        </section>

        {/* Comparison table */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-amber-900 mb-4">Feature Comparison</h2>
          <div className="overflow-x-auto rounded-xl border border-amber-200 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-900 text-amber-50">
                  <th className="text-left px-4 py-3 font-semibold w-1/2">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold w-1/4">
                    <span className="flex items-center justify-center gap-1.5">
                      <span
                        className="rounded-full"
                        style={{ width: 10, height: 10, background: '#fff', display: 'inline-block' }}
                        aria-hidden="true"
                      />
                      boop
                    </span>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold w-1/4">{data.name}</th>
                </tr>
              </thead>
              <tbody>
                {data.features.map((feature, i) => (
                  <tr
                    key={feature.name}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50'}
                  >
                    <td className="px-4 py-3 text-gray-800 font-medium">{feature.name}</td>
                    <td className="px-4 py-3 text-center">
                      <FeatureCell value={feature.poo} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <FeatureCell value={feature.competitor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-amber-900 text-amber-50 rounded-2xl px-8 py-10 text-center shadow-lg">
          <div
            className="mx-auto mb-5 rounded-full"
            style={{ width: 44, height: 44, background: 'var(--boop-accent)' }}
            aria-hidden="true"
          />
          <h2 className="text-2xl md:text-3xl font-black mb-3">
            Ready to ditch {data.name}?
          </h2>
          <p className="text-amber-200 text-lg mb-6 max-w-xl mx-auto">
            {data.ctaSubtext}
          </p>
          <a
            href="/"
            className="inline-block bg-amber-400 hover:bg-amber-300 text-amber-900 font-bold text-lg px-8 py-3 rounded-xl transition-colors shadow"
          >
            Try boop Free
          </a>
          <p className="text-amber-300 text-sm mt-4">
            Free forever for up to 5 lists. No credit card needed.
          </p>
        </section>

        {/* Other comparisons */}
        <section className="mt-12">
          <h3 className="text-lg font-bold text-amber-900 mb-4">More comparisons</h3>
          <div className="flex flex-wrap gap-3">
            {Object.values(COMPETITORS)
              .filter(c => c.slug !== data.slug)
              .map(c => (
                <a
                  key={c.slug}
                  href={`/compare/${c.slug}`}
                  className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium rounded-lg transition-colors text-sm border border-amber-200"
                >
                  boop vs {c.name} &rarr;
                </a>
              ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-amber-200 py-6 px-4 text-center text-amber-600 text-sm mt-4">
        <p>
          <a href="/" className="boop-wordmark hover:opacity-80 transition-opacity" aria-label="boop">
            <span className="boop-dot" aria-hidden="true" style={{ width: 10, height: 10 }} />
            <span>boop</span>
          </a>
          {' · '}
          <a href="/pricing" className="hover:text-amber-900 transition-colors">Pricing</a>
          {' · '}
          <a href="/privacy" className="hover:text-amber-900 transition-colors">Privacy</a>
          {' · '}
          <a href="/terms" className="hover:text-amber-900 transition-colors">Terms</a>
        </p>
      </footer>
    </div>
  )
}
