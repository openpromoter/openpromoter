export function snippets(appUrl: string, slug: string, programId: string) {
  const script = `<script async src="${appUrl}/op.js" data-program="${slug}"></script>`;
  const checkout = `// Server: pass the click id to Stripe Checkout so the sale is attributed
// even if cookies are blocked. Send openpromoter.clickId from the browser.
const session = await stripe.checkout.sessions.create({
  // ...your existing options
  client_reference_id: req.body.opClickId,          // "clk_..." from window.openpromoter.clickId
  subscription_data: { metadata: { op_click: req.body.opClickId } },
});`;
  const npm = `npm install openpromoter

import { OpenPromoter } from "openpromoter";
const op = new OpenPromoter({ apiKey: process.env.OPENPROMOTER_API_KEY, baseUrl: "${appUrl}" });

// after signup, before payment:
await op.leads.create({ programId: "${programId}", email: user.email, clickId: req.cookies.op_click });`;
  const prompt = `Add the OpenPromoter affiliate program to this app.

1. Add this script tag to the <head> of every marketing and app page:
   ${script}
2. When a user signs up, call window.openpromoter.signup({ email }) in the browser (it records the referral as a lead).
3. Wherever this app creates a Stripe Checkout Session, pass the visitor's click id:
   client_reference_id: <value of window.openpromoter.clickId sent from the browser>
   and subscription_data.metadata.op_click with the same value. If the app uses Stripe Payment Links or the Pricing Table, nothing else is needed: op.js adds client_reference_id automatically.
4. Do not change prices, plans or any other billing logic.
5. Afterwards, load the site once so OpenPromoter can verify the install.

Docs: https://openpromoter.com/docs/tracking`;
  return { script, checkout, npm, prompt };
}
