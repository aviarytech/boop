import { useEffect } from 'react';

export function Terms() {
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
          <h1 className="text-3xl font-black">Terms of Service</h1>
          <p className="text-amber-200 mt-1 text-sm">Last updated: March 2026</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 prose prose-amber">
        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Agreement to Terms</h2>
          <p className="text-amber-800 leading-relaxed">
            By accessing or using boop (&quot;the Service&quot;), operated by Aviary Tech (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;),
            you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">User Accounts</h2>
          <ul className="space-y-2 text-amber-800">
            <li>You must provide accurate information when creating an account.</li>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You are responsible for all activity that occurs under your account.</li>
            <li>You must be at least 13 years of age to use the Service.</li>
            <li>You may not share your account with others or create accounts on behalf of third parties without authorization.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Acceptable Use</h2>
          <p className="text-amber-800 leading-relaxed mb-2">You agree not to use the Service to:</p>
          <ul className="space-y-2 text-amber-800">
            <li>Violate any applicable laws or regulations.</li>
            <li>Infringe the intellectual property rights of others.</li>
            <li>Transmit spam, malware, or other harmful content.</li>
            <li>Attempt to gain unauthorized access to the Service or its infrastructure.</li>
            <li>Interfere with or disrupt the integrity or performance of the Service.</li>
            <li>Harass, abuse, or harm other users.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Payment Terms</h2>
          <p className="text-amber-800 leading-relaxed">
            Paid features are billed through Stripe. By subscribing, you authorize us to charge your payment method
            on a recurring basis at the applicable rate. Subscriptions auto-renew unless cancelled before the renewal date.
            We reserve the right to change pricing with 30 days&apos; notice. Refunds are handled on a case-by-case basis —
            contact us at <a href="mailto:support@boop.ad" className="text-amber-600 underline">support@boop.ad</a>.
            We never store your full card details — all payment processing is handled by Stripe and subject to{' '}
            <a href="https://stripe.com/legal" className="text-amber-600 underline" target="_blank" rel="noopener noreferrer">Stripe&apos;s terms</a>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Intellectual Property</h2>
          <p className="text-amber-800 leading-relaxed">
            The Service, including its design, code, and branding, is owned by Aviary Tech and protected by
            applicable intellectual property laws. You retain ownership of the content you create (lists, tasks, notes).
            By using the Service, you grant us a limited license to store and display your content solely for the
            purpose of providing the Service to you.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Limitation of Liability</h2>
          <p className="text-amber-800 leading-relaxed">
            To the fullest extent permitted by law, Aviary Tech shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from your use of or inability to use the Service.
            Our total liability for any claim arising from these terms or your use of the Service shall not exceed
            the amount you paid us in the 12 months preceding the claim.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Disclaimer of Warranties</h2>
          <p className="text-amber-800 leading-relaxed">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, express or implied.
            We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Governing Law</h2>
          <p className="text-amber-800 leading-relaxed">
            These Terms are governed by the laws of the Province of British Columbia, Canada, without regard to
            conflict of law principles. Any disputes shall be resolved in the courts of British Columbia, and you
            consent to personal jurisdiction in those courts.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Termination</h2>
          <p className="text-amber-800 leading-relaxed">
            We may suspend or terminate your account at any time for violation of these Terms. You may delete your
            account at any time from the app settings. Upon termination, your right to use the Service ceases
            immediately. We may retain certain data as required by law or for legitimate business purposes.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Changes to These Terms</h2>
          <p className="text-amber-800 leading-relaxed">
            We may update these Terms from time to time. We will notify you of material changes via email or
            an in-app notice. Continued use of the Service after changes constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-3">Contact</h2>
          <p className="text-amber-800 leading-relaxed">
            Questions about these Terms? Email us at{' '}
            <a href="mailto:legal@boop.ad" className="text-amber-600 underline">legal@boop.ad</a>.
          </p>
        </section>
      </main>
    </div>
  )
}
