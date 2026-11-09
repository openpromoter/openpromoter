/**
 * Demo workspace for self-hosters and performance testing.
 *   pnpm db:seed            # creates the demo if it doesn't exist
 *   pnpm db:seed --reset    # deletes and recreates it
 * Sign in: demo@openpromoter.test / openpromoter-demo
 */
import {
  account,
  agentAction,
  billingCustomer,
  billingPrice,
  campaign,
  contentAsset,
  fraudFlag,
  link,
  member,
  message,
  partner,
  partnerGroup,
  program,
  promoCode,
  resource,
  user,
  workspace,
} from "@openpromoter/db";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { DEMO } from "../src/lib/demo-accounts";
import { createId } from "../src/lib/id";

export { DEMO };

import { templateKit } from "../src/server/ai/content";
import { db } from "../src/server/db";
import { payableBalances } from "../src/server/ledger";
import { createPayoutBatch } from "../src/server/payouts";
import { defaultTerms } from "../src/server/setup";

/** Demo partner conversations, so the inbox isn't empty on first run. */
const DEMO_THREADS: { partner: number; lines: { from: "partner" | "you"; body: string }[] }[] = [
  {
    partner: 1,
    lines: [
      {
        from: "partner",
        body: "Quick one: does the 2x annual boost stack with my Elite rate, or is it one or the other?",
      },
      {
        from: "you",
        body: "It applies on top of your rate: Elite 40% becomes 80% on annual plans until the 23rd.",
      },
      {
        from: "partner",
        body: "Perfect. Sending it to my list on Thursday. Can you share a screenshot I can use in the newsletter?",
      },
    ],
  },
  {
    partner: 0,
    lines: [
      { from: "partner", body: "My October payout shows as approved but not paid yet. Is that normal?" },
      {
        from: "you",
        body: "Yes. Payouts go out on the 1st after the 30-day refund window. Yours is in the batch waiting for approval now.",
      },
    ],
  },
  {
    partner: 4,
    lines: [
      {
        from: "you",
        body: "Your YouTube review drove 120 trials last week. Want early access to the new dashboard to film a follow-up?",
      },
      { from: "partner", body: "Absolutely, yes. Send it over whenever it's ready." },
    ],
  },
  {
    partner: 7,
    lines: [
      {
        from: "partner",
        body: "Is there a coupon code I can give my audience instead of a link? Podcast listeners don't click.",
      },
    ],
  },
];

const NAMES = [
  "Maya Chen",
  "Leo Martins",
  "Priya Raman",
  "Sam Okafor",
  "Nora Lindqvist",
  "Diego Alvarez",
  "Hana Sato",
  "Omar Haddad",
  "Ella Brooks",
  "Tomás Novak",
  "Zoe Kim",
  "Arjun Mehta",
  "Lena Fischer",
  "Kofi Mensah",
  "Isla Murphy",
  "Mateo Rossi",
  "Aiko Tanaka",
  "Ben Carter",
  "Sofia Petrova",
  "Noah Williams",
  "Amara Diallo",
  "Felix Wagner",
  "Chloe Dubois",
  "Ravi Shah",
  "Grace Liu",
  "Jonas Berg",
  "Mia Thompson",
  "Yusuf Kaya",
  "Ava Johnson",
  "Luca Bianchi",
  "Emma Clarke",
  "Kenji Mori",
  "Olivia Brown",
  "Ethan Park",
  "Sara Nilsson",
  "David Cohen",
  "Lucia Garcia",
  "Max Müller",
  "Ines Costa",
  "Theo Laurent",
];

/**
 * `publicDemo`: the hosted demo anyone can open (demo.ts). No password (visitors get in through the demo
 * button), autopilot off (no AI spend) and kept out of the partner marketplace, which lists real programs.
 */
export async function seed({
  reset = false,
  clicks = 100_000,
  conversions = 10_000,
  publicDemo = false,
} = {}) {
  const d = db();
  const [existing] = await d.select().from(program).where(eq(program.slug, DEMO.slug));
  if (existing && !reset) {
    console.log("Demo workspace already exists (use --reset to recreate)");
    return existing.id;
  }
  if (existing) await d.delete(workspace).where(eq(workspace.id, existing.workspaceId));
  await d.delete(user).where(eq(user.email, DEMO.email));
  await d.delete(user).where(eq(user.email, DEMO.partnerEmail));

  const userId = crypto.randomUUID();
  await d.insert(user).values({ id: userId, name: "Demo Founder", email: DEMO.email, emailVerified: true });
  if (!publicDemo)
    await d.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(DEMO.password),
    });

  const wsId = createId("ws");
  await d
    .insert(workspace)
    .values({ id: wsId, name: "Acme Analytics", slug: `acme-${Date.now().toString(36)}` });
  await d.insert(member).values({ workspaceId: wsId, userId, role: "owner" });

  const programId = createId("prg");
  const now = Date.now();
  const [prog] = await d
    .insert(program)
    .values({
      id: programId,
      workspaceId: wsId,
      name: "Acme Analytics",
      slug: DEMO.slug,
      websiteUrl: "https://acme-analytics.example",
      commissionType: "percent",
      commissionValue: 3000,
      commissionDuration: "months",
      commissionMonths: 12,
      cookieDays: 90,
      // two-tier: recruiters earn 10% of their recruits' commissions; listed in the marketplace
      overrideRate: 1000,
      listedInNetwork: !publicDemo,
      autopilotEnabled: !publicDemo,
      category: "Analytics",
      brand: {
        color: "#4F46E5",
        logoUrl: null,
        headline: "Earn 30% recommending Acme Analytics",
        description:
          "Privacy-friendly product analytics for SaaS teams. Dashboards in minutes, no cookies, no sampling.",
      },
      autoApprove: {
        enabled: true,
        maxRiskScore: 40,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: [],
      },
      doubleSided: { enabled: true, percentOff: 20, durationMonths: 3 },
      applicationQuestions: [
        { id: "how", label: "How will you promote Acme Analytics?", type: "textarea", required: true },
      ],
      terms: defaultTerms("Acme Analytics"),
      designRationale: {
        commission:
          "30% of every payment. On the typical plan ($49/month) a partner earns about $14.70 a month per customer.",
        duration: "For the first 12 months of each customer.",
        cookie: "90 days, because annual plans are popular and buyers compare for weeks.",
        doubleSided: "Referred customers get 20% off for 3 months.",
        tiers: "Three tiers with automatic promotion.",
        payouts: "Monthly, $50 minimum, 30 day hold.",
      },
      installVerifiedAt: new Date(now - 60 * 86_400_000),
      createdAt: new Date(now - 200 * 86_400_000),
    })
    .returning();

  await d.insert(billingPrice).values([
    {
      id: createId("bpr"),
      workspaceId: wsId,
      provider: "stripe",
      externalId: "price_demo_starter",
      productName: "Starter",
      unitAmount: 1900,
      currency: "usd",
      interval: "month",
    },
    {
      id: createId("bpr"),
      workspaceId: wsId,
      provider: "stripe",
      externalId: "price_demo_pro",
      productName: "Pro",
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
    },
    {
      id: createId("bpr"),
      workspaceId: wsId,
      provider: "stripe",
      externalId: "price_demo_pro_y",
      productName: "Pro (annual)",
      unitAmount: 49000,
      currency: "usd",
      interval: "year",
    },
  ]);

  const groups = [
    {
      id: createId("grp"),
      programId,
      name: "Partner",
      rank: 0,
      isDefault: true,
      commissionType: "percent" as const,
      commissionValue: 3000,
      promoteAtRevenue: null,
    },
    {
      id: createId("grp"),
      programId,
      name: "Pro",
      rank: 1,
      isDefault: false,
      commissionType: "percent" as const,
      commissionValue: 3500,
      promoteAtRevenue: 500_000,
    },
    {
      id: createId("grp"),
      programId,
      name: "Elite",
      rank: 2,
      isDefault: false,
      commissionType: "percent" as const,
      commissionValue: 4000,
      promoteAtRevenue: 2_500_000,
    },
  ];
  await d.insert(partnerGroup).values(groups);

  const partners = NAMES.map((name, i) => {
    const status =
      i < 34 ? "approved" : i < 37 ? "pending" : i === 37 ? "paused" : i === 38 ? "rejected" : "approved";
    const first = name.split(" ")[0]!.toLowerCase().normalize("NFKD").replace(/[^\w]/g, "");
    return {
      id: createId("prt"),
      programId,
      workspaceId: wsId,
      email: `${first}@partners.example`,
      name,
      website: `https://${first}.example`,
      country: ["US", "GB", "DE", "IN", "BR", "FR", "JP", "CA", "NL", "ES"][i % 10],
      status: status as "approved",
      groupId: groups[i < 3 ? 2 : i < 9 ? 1 : 0]!.id,
      code: first,
      answers: { how: "Newsletter and YouTube reviews of analytics tools." },
      source: (i % 4 === 0 ? "recruiter" : "application") as "application",
      payoutMethod: (["stripe", "paypal", "wise", "manual"] as const)[i % 4],
      paypalEmail: i % 4 === 1 ? `${first}@partners.example` : null,
      wiseEmail: i % 4 === 2 ? `${first}@partners.example` : null,
      stripeAccountId: i % 4 === 0 ? `acct_demo_${i}` : null,
      stripePayoutsEnabled: i % 4 === 0,
      taxFormType: (i % 10 === 0 ? "w9" : "w8ben") as "w9",
      taxFormStatus: (i % 3 === 0 ? "submitted" : "missing") as "missing",
      riskScore: i === 33 ? 82 : i === 32 ? 55 : 0,
      approvedAt: status === "approved" ? new Date(now - (190 - i * 3) * 86_400_000) : null,
      createdAt: new Date(now - (190 - i * 3) * 86_400_000),
      lastActiveAt: i > 28 && i < 32 ? new Date(now - 45 * 86_400_000) : new Date(now - (i % 5) * 86_400_000),
    };
  });
  // two-tier: partners 10-12 joined through partner 1's recruit link
  for (const i of [10, 11, 12]) Object.assign(partners[i]!, { recruitedBy: partners[1]!.id });
  // one partner can sign in to the portal (the public demo's partner side; no password there either)
  const demoPartnerUser = crypto.randomUUID();
  const dp = partners[DEMO.partnerIndex]!;
  if (dp.email !== DEMO.partnerEmail) throw new Error(`demo partner email drifted: ${dp.email}`);
  await d.insert(user).values({ id: demoPartnerUser, name: dp.name, email: dp.email, emailVerified: true });
  Object.assign(dp, { userId: demoPartnerUser });
  await d.insert(partner).values(partners);
  await d.insert(link).values(
    partners.map((p) => ({
      id: createId("lnk"),
      programId,
      partnerId: p.id,
      key: `${p.code}1`,
      destination: prog!.websiteUrl,
      label: "Default link",
    })),
  );
  await d
    .insert(promoCode)
    .values(
      partners
        .slice(0, 8)
        .map((p) => ({ id: createId("prm"), programId, partnerId: p.id, code: `${p.code.toUpperCase()}20` })),
    );

  // Clicks, referrals and commissions are generated in SQL for speed. Partner weight follows a power law.
  const active = partners.filter((p, i) => p.status === "approved" && !(i > 28 && i < 32));
  // temp tables live on one connection: one transaction keeps every step on it (the app's pool has many)
  await d.transaction(async (tx) => {
    await tx.execute(sql`drop table if exists seed_cdf; drop table if exists seed_partner`);
    await tx.execute(sql`create temp table seed_partner (idx int, id text, w float) on commit drop`);
    await tx.execute(
      sql`insert into seed_partner values ${sql.join(
        active.map((p, i) => sql`(${i}, ${p.id}, ${1 / (i + 1) ** 0.9})`),
        sql`, `,
      )}`,
    );
    await tx.execute(
      sql`create temp table seed_cdf on commit drop as select id, sum(w) over (order by idx) / sum(w) over () as hi from seed_partner`,
    );
    const sources = ["youtube", "newsletter", "twitter", "blog", "linkedin", "reddit"];
    await tx.execute(sql`
      insert into click (id, program_id, partner_id, link_id, visitor_id, ip_hash, user_agent, referrer, landing_url, country, sub_id, utm, is_bot, created_at)
      select 'clk_seed' || g, ${programId}, p.id, null, 'vis_seed' || g, md5('ip' || (g % 40000)), 'Mozilla/5.0 (Macintosh) Safari/605.1', 'https://' || (array[${sql.raw(sources.map((s) => `'${s}.com'`).join(","))}])[1 + g % 6] || '/',
        ${prog!.websiteUrl} || '/?via=x', (array['US','GB','DE','IN','BR','FR'])[1 + g % 6], case when g % 7 = 0 then 'yt' end,
        jsonb_build_object('utm_source', (array[${sql.raw(sources.map((s) => `'${s}'`).join(","))}])[1 + g % 6]), g % 97 = 0,
        now() - (power(random(), 1.3) * interval '180 days')
      from generate_series(1, ${clicks}) g
      cross join lateral (select id from seed_cdf where hi >= ((g * 0.6180339887) - floor(g * 0.6180339887)) order by hi limit 1) p`);
    // referrals: leads from clicks; ~70% of them convert
    const leads = Math.round(conversions / 0.7);
    await tx.execute(sql`
      insert into referral (id, program_id, partner_id, click_id, visitor_id, email, external_customer_id, via, status, mrr, revenue, paid_invoices, converted_at, canceled_at, created_at)
      select 'ref_seed' || c.n, ${programId}, c.partner_id, c.id, c.visitor_id, 'customer' || c.n || '@example.com',
        case when c.n <= ${conversions} then 'cus_seed' || c.n end, 'link',
        (case when c.n > ${conversions} then 'lead' when c.n % 9 = 0 then 'canceled' when c.n % 31 = 0 then 'refunded' when c.n % 13 = 0 then 'trialing' else 'active' end)::text,
        case when c.n <= ${conversions} and c.n % 9 <> 0 and c.n % 31 <> 0 then (array[1900,4900,4083])[1 + c.n % 3] else 0 end, 0, 0,
        case when c.n <= ${conversions} then c.created_at + interval '2 days' end,
        case when c.n <= ${conversions} and c.n % 9 = 0 then c.created_at + interval '40 days' end,
        c.created_at + interval '1 hour'
      from (select *, row_number() over (order by random()) n from click where program_id = ${programId} and is_bot = false and created_at < now() - interval '3 days') c
      where c.n <= ${leads}`);
    // one commission per paid month since conversion (cap 12), 30% (35/40% for higher tiers)
    await tx.execute(sql`
      insert into commission (id, program_id, workspace_id, partner_id, referral_id, kind, source_key, sale_amount, amount, currency, status, hold_until, external_charge_id, description, created_at, updated_at)
      select 'com_seed' || r.id || '_' || m, ${programId}, ${wsId}, r.partner_id, r.id, 'sale', 'stripe:in_seed_' || r.id || '_' || m,
        p.price, round(p.price * coalesce(g.commission_value, 3000) / 10000.0), 'usd',
        case when r.status = 'refunded' and m = 0 then 'reversed' when r.converted_at + (m || ' months')::interval > now() - interval '30 days' then 'pending' else 'approved' end,
        r.converted_at + (m || ' months')::interval + interval '30 days', 'ch_seed_' || r.id || '_' || m,
        (array['Starter','Pro','Pro (annual)'])[1 + (substring(r.id from 9)::int % 3)] || ' · ' || coalesce(g.commission_value, 3000) / 100 || '% of the payment',
        r.converted_at + (m || ' months')::interval, now()
      from referral r
      join partner pt on pt.id = r.partner_id
      left join partner_group g on g.id = pt.group_id
      cross join lateral (select (array[1900,4900,49000])[1 + (substring(r.id from 9)::int % 3)] as price) p
      cross join lateral generate_series(0, least(11, floor(extract(epoch from (coalesce(r.canceled_at, now()) - r.converted_at)) / 2592000)::int)) m
      where r.program_id = ${programId} and r.converted_at is not null and r.status <> 'trialing'
        and (p.price <> 49000 or m = 0)
        and r.converted_at + (m || ' months')::interval <= now()`);
    await tx.execute(sql`
      update referral r set revenue = s.rev, paid_invoices = s.n
      from (select referral_id, sum(sale_amount)::int rev, count(*)::int n from commission where program_id = ${programId} and status <> 'reversed' group by referral_id) s
      where s.referral_id = r.id`);
    // two-tier: the recruiter's 10% override on each recruit's sale commission
    await tx.execute(sql`
      insert into commission (id, program_id, workspace_id, partner_id, referral_id, kind, parent_id, source_key, sale_amount, amount, currency, status, hold_until, external_charge_id, description, created_at, updated_at)
      select 'com_ovr' || substring(c.id from 4), c.program_id, c.workspace_id, sub.recruited_by, c.referral_id, 'override', c.id, 'override:' || c.id,
        0, round(c.amount * 0.1), c.currency, c.status, c.hold_until, c.external_charge_id, '10% of ' || sub.name || '''s commission', c.created_at, now()
      from commission c join partner sub on sub.id = c.partner_id
      where c.program_id = ${programId} and c.kind = 'sale' and sub.recruited_by is not null`);
    // pay out everything approved before 60 days ago, one payout per partner
    await tx.execute(sql`
      with owed as (
        select partner_id, sum(amount)::int total from commission where program_id = ${programId} and status = 'approved' and created_at < now() - interval '60 days' group by partner_id
      ), ins as (
        insert into payout (id, program_id, workspace_id, partner_id, amount, currency, method, status, approved_by, approved_at, paid_at, invoice_number, external_id, created_at)
        select 'pay_seed_' || o.partner_id, ${programId}, ${wsId}, o.partner_id, o.total, 'usd', coalesce(p.payout_method, 'manual'), 'paid', ${userId}, now() - interval '20 days', now() - interval '20 days',
          'OP-' || lpad((row_number() over ())::text, 5, '0'), 'seed_ref_' || row_number() over (), now() - interval '21 days'
        from owed o join partner p on p.id = o.partner_id
        returning partner_id, id
      )
      update commission c set status = 'paid', payout_id = ins.id from ins
      where c.partner_id = ins.partner_id and c.program_id = ${programId} and c.status = 'approved' and c.created_at < now() - interval '60 days'`);
    await tx.execute(sql`drop table if exists seed_cdf; drop table if exists seed_partner`);
  });

  // a held self-referral and a brand-bidding partner for the fraud screen
  const risky = partners[33]!;
  const bidder = partners[32]!;
  await d.insert(fraudFlag).values([
    {
      id: createId("frd"),
      programId,
      partnerId: risky.id,
      referralId: "",
      signal: "self_referral",
      score: 95,
      detail: "The customer email matches the partner's own email.",
    },
    {
      id: createId("frd"),
      programId,
      partnerId: risky.id,
      referralId: "x",
      signal: "duplicate_accounts",
      score: 60,
      detail: "6 referred accounts share a network with at least two others.",
    },
    {
      id: createId("frd"),
      programId,
      partnerId: bidder.id,
      referralId: "",
      signal: "brand_bidding",
      score: 55,
      detail: "14 clicks came from paid search ads.",
    },
  ]);
  await d.execute(
    sql`update commission set status = 'held', held_reason = 'Auto-held: risk score 82' where partner_id = ${risky.id} and status in ('pending','approved')`,
  );

  await d.insert(campaign).values([
    {
      id: createId("cmp"),
      programId,
      name: "2x commissions on annual plans",
      description: "Double commissions for annual plans this month",
      rule: { kind: "boost", multiplier: 2, intervals: ["year"] },
      status: "active",
      startsAt: new Date(now - 5 * 86_400_000),
      endsAt: new Date(now + 20 * 86_400_000),
    },
    {
      id: createId("cmp"),
      programId,
      name: "Content bounty",
      description: "Pay $50 per YouTube review",
      rule: { kind: "bounty", trigger: "post", reward: 5000 },
      status: "active",
      startsAt: new Date(now - 10 * 86_400_000),
      endsAt: null,
    },
    {
      id: createId("cmp"),
      programId,
      name: "Revenue contest",
      description: "Top 3 by revenue win $500, $250, $100",
      rule: { kind: "contest", metric: "revenue", prizes: [50000, 25000, 10000] },
      status: "active",
      startsAt: new Date(now - 12 * 86_400_000),
      endsAt: new Date(now + 18 * 86_400_000),
    },
  ]);
  await d.insert(contentAsset).values(
    templateKit(prog!, {
      name: prog!.name,
      description: prog!.brand.description ?? null,
      headline: "Analytics without the cookie banner",
    }).map((a) => ({
      id: createId("cnt"),
      programId,
      kind: a.kind,
      title: a.title,
      body: a.body,
      meta: a.meta ?? null,
      generatedBy: "template" as const,
      sourceHash: "seed",
    })),
  );
  await d.insert(resource).values([
    {
      id: createId("res"),
      programId,
      title: "Brand kit (logos, screenshots)",
      url: "https://acme-analytics.example/brand",
      description: "SVG logos and product screenshots",
    },
  ]);
  await d.insert(message).values([
    {
      id: createId("msg"),
      programId,
      partnerId: null,
      subject: "New: 2x commissions on annual plans",
      body: "Double commissions for annual plans this month. It's live now.",
    },
    ...DEMO_THREADS.flatMap((t, ti) =>
      t.lines.map((l, li) => ({
        id: createId("msg"),
        programId,
        partnerId: partners[t.partner]!.id,
        fromPartner: l.from === "partner",
        body: l.body,
        readAt: ti === 0 && li === t.lines.length - 1 ? null : new Date(now - (ti * 7 + 1) * 3_600_000),
        createdAt: new Date(now - (ti * 7 + (t.lines.length - li)) * 3_600_000 - li * 600_000),
      })),
    ),
  ]);
  await d.insert(billingCustomer).values(
    Array.from({ length: 30 }, (_, i) => ({
      id: createId("bcu"),
      workspaceId: wsId,
      provider: "stripe",
      externalId: `cus_direct_${i}`,
      email: `happy${i}@customers.example`,
      name: `${NAMES[(i * 7) % NAMES.length]!.split(" ")[0]} Customer`,
      lifetimeValue: 4900 * (24 - (i % 20)),
      currency: "usd",
      activeSubscription: i % 5 !== 0,
      customerSince: new Date(now - (700 - i * 15) * 86_400_000),
    })),
  );
  await d.insert(agentAction).values([
    {
      id: createId("act"),
      programId,
      source: "autopilot",
      kind: "promote_tier",
      title: `Move ${partners[3]!.name} to Elite`,
      detail: `${partners[3]!.name} is one of your top partners this month. A higher tier keeps them motivated.`,
      payload: { partnerId: partners[3]!.id, toGroupId: groups[2]!.id, fromGroupId: groups[1]!.id },
      impact: 180000,
    },
    {
      id: createId("act"),
      programId,
      source: "autopilot",
      kind: "pause_partner",
      title: `Pause ${risky.name} (risk 82)`,
      detail:
        "Fraud checks scored this partner 82/100. Pausing stops new commissions and holds unpaid ones until you review.",
      targetType: "partner",
      targetId: risky.id,
      payload: { partnerId: risky.id, prevStatus: "approved" },
    },
    {
      id: createId("act"),
      programId,
      source: "autopilot",
      kind: "message_idle",
      title: "Re-engage 3 quiet partners",
      detail:
        "3 approved partners sent no clicks in 30 days. Autopilot drafted a short note pointing them to the content kit.",
      payload: {
        partnerIds: partners.slice(29, 32).map((p) => p.id),
        subject: "New content to share for Acme Analytics",
        body: "You still earn 30% on every customer you refer. The content kit in your portal has ready-made posts, emails and banners. Reply if anything would make sharing us easier.",
      },
    },
  ]);
  // a few payouts waiting for approval so the Payouts page shows the review step
  const owed = (await payableBalances(programId)).sort((a, b) => b.approved - a.approved).slice(0, 6);
  await createPayoutBatch(
    programId,
    { type: "system", id: null },
    owed.map((o) => o.partnerId),
  );
  console.log(
    `Seeded demo program ${programId}: ${partners.length} partners, ${clicks} clicks, ${conversions} conversions. ${publicDemo ? "Public demo: open /demo" : `Sign in as ${DEMO.email} / ${DEMO.password}`}`,
  );
  return programId;
}

if (/seed\.[tj]s$/.test(process.argv[1] ?? "")) {
  seed({ reset: process.argv.includes("--reset") })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
