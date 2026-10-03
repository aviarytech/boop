import { useEffect } from 'react';

export function Privacy() {
  useEffect(() => {
    document.body.classList.add('scrollable-page');
    return () => document.body.classList.remove('scrollable-page');
  }, []);

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-900 text-amber-50 py-6 px-4">
        <div className="max-w-3xl mx-auto">
          <a href="/" className="flex items-center gap-2 mb-4 text-amber-200 hover:text-white transition-colors text-sm">
            &larr; Back to boop
          </a>
          <h1 className="text-3xl font-black">Privacy Policy</h1>
          <p className="text-amber-200 mt-1 text-sm">Last updated: March 2026</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 prose prose-amber">
        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Overview</h2>
          <p className="text-amber-800 leading-relaxed">
            boop (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a todo list and task management application.
            We take your privacy seriously. This policy explains what data we collect, how we use it,
            and your rights regarding your personal information.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Data We Collect</h2>
          <ul className="space-y-2 text-amber-800">
            <li><strong>Account information:</strong> Email address used to create your account.</li>
            <li><strong>User content:</strong> Lists, tasks, and notes you create in the app.</li>
            <li><strong>Usage analytics:</strong> Anonymous, aggregated data about how features are used (no personally identifiable information).</li>
            <li><strong>Device information:</strong> Device type and OS version for debugging purposes.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">How We Use Your Data</h2>
          <ul className="space-y-2 text-amber-800">
            <li>To provide and improve the boop service.</li>
            <li>To sync your lists across devices.</li>
            <li>To enable list sharing with collaborators you invite.</li>
            <li>To send transactional emails (account verification, password reset).</li>
            <li>To process subscription payments (via Stripe — we never store card details).</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Data Storage &amp; Security</h2>
          <p className="text-amber-800 leading-relaxed">
            Your data is stored on servers in the United States using Convex, a real-time database platform.
            All data in transit is encrypted via TLS. Your lists are cryptographically signed with your
            personal Decentralized Identifier (DID) — only you can prove ownership of your data.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Data Sharing</h2>
          <p className="text-amber-800 leading-relaxed">
            We do not sell your personal data to third parties. We share data only with:
          </p>
          <ul className="space-y-2 text-amber-800 mt-2">
            <li><strong>Convex:</strong> Real-time database and backend infrastructure.</li>
            <li><strong>Stripe:</strong> Payment processing (subject to Stripe&apos;s privacy policy).</li>
            <li><strong>Collaborators you invite:</strong> List contents are visible to anyone you share a list with.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Offline Data</h2>
          <p className="text-amber-800 leading-relaxed">
            boop stores a local copy of your lists on your device to support offline access.
            This data is stored in your device&apos;s local storage and is not accessible to other apps.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Your Rights</h2>
          <ul className="space-y-2 text-amber-800">
            <li><strong>Access:</strong> You can export your lists at any time from the app settings.</li>
            <li><strong>Deletion:</strong> You can delete your account and all associated data by contacting us.</li>
            <li><strong>Correction:</strong> You can update your account information in the app.</li>
            <li><strong>Portability:</strong> Your list data is available in standard formats upon request.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Children&apos;s Privacy</h2>
          <p className="text-amber-800 leading-relaxed">
            boop is not directed at children under 13 years of age. We do not knowingly collect
            personal information from children under 13.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Changes to This Policy</h2>
          <p className="text-amber-800 leading-relaxed">
            We may update this privacy policy from time to time. We will notify you of material changes
            via email or an in-app notice. Continued use of the app after changes constitutes acceptance.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Contact</h2>
          <p className="text-amber-800 leading-relaxed">
            Questions about this privacy policy? Email us at{' '}
            <a href="mailto:privacy@boop.ad" className="text-amber-600 underline">privacy@boop.ad</a>.
          </p>
        </section>
      </main>
    </div>
  )
}
