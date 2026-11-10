# Content and design guidelines

The house rules for OpenPromoter copy and design. They apply to every string a person reads: the
website, the app, the partner portal, emails, docs, the README and alt text. A single violation
fails the change.

## 1. Hard rules

- **No em dashes (—)** anywhere. Rewrite the sentence; two short sentences beat one joined by a dash.
  An en dash in a numeric range ("9–17") is fine.
- **No horizontal rules** (`---`, `***`) inside page copy.
- **Sentences of 25 words or fewer.** Split anything longer.
- **Paragraphs of 3 sentences or fewer.** A block of 4+ sentences or about 55+ words is a wall: split it.
- **No exclamation marks** in body copy.
- **American English:** license, catalog, color, recognized, fulfillment, canceled.
- **Plain words.** A busy founder reading on a phone should understand every sentence the first time.
  Technical terms the reader uses (webhook, API key, MRR, EPC, 2FA) stay.

## 2. Commas only where the grammar needs one

Four shapes read as AI writing and are banned:

1. **Stock tails:** ", answered straight.", ", in plain terms.", ", with no extra setup.",
   ", every day of the week.", ", no questions asked." Drop the tail or fold the fact in.
2. **Contrast tags:** "X, not Y" and "X, not just Y" ("We report clicks, not impressions").
   State the positive claim on its own ("We report the clicks you gained").
3. **Stacked fragments and adjectives in short items** (card title, description, list item, table cell,
   label, button: 14 words or fewer): "Clean, fast code", "Native fit, no new system". A comma stays only
   in a real "A, B and C" list, after an opening clause, or in a number, date or address.
   Rewrite as one phrase ("Clean code that loads fast").
4. **Hidden second sentences:** ", so the ...", ", then ...", ", rather than ...", ", instead of ...",
   ", which means ...". End the sentence before the comma. Menu paths use `>` (Settings > Billing).

Also:

- **Headings, titles, captions and alt text take no comma** except a real list.
- **Lists are "A, B and C"**: no Oxford comma.
- Source credits read `Source: X (November 2026)`.

Check every new string with the comma linter, which is a library with no CLI:

```bash
python3 -c "import sys; sys.path.insert(0, '$HOME/ddpush'); from commalint import lint; print(lint('Your text here', 'short'))"
```

Use kind `'short'` for 14 words or fewer, `'p'` for paragraphs, `'h'` for headings. An empty list means clean.
Running `commalint.py` on a file prints nothing and proves nothing.

## 3. Banned words

- **Adjectives:** seamless, robust, comprehensive, bespoke, tailored, curated, powerful, innovative,
  cutting-edge, holistic, intuitive, effortless, meticulous, elegant, sophisticated, strategic, vital,
  crucial, pivotal, optimal, extensive, significant, renowned, vibrant, world-class, best-in-class,
  high-performance.
- **Verbs:** leverage, utilize, facilitate, implement (say add, set up or run), streamline, empower,
  harness, bolster, optimize (vague), supercharge, elevate, delight, unlock.
- **Nouns:** ecosystem, landscape, paradigm, synergy, framework (the buzzword sense), methodology,
  functionality.
- **Transition openers:** Furthermore, Moreover, Additionally, Notably, Crucially, Ultimately,
  Essentially, Clearly, Obviously. Make the point.

## 4. No idioms

Say what happens. Examples already rewritten on the theme:
out of the box → by default · on autopilot → automatically · under the hood → in the background ·
moves the needle → makes the biggest difference · pays for itself → earns its cost back ·
bottleneck → what is actually slow · drop us a line → send us a message · in the green → passing.

## 5. Humanizer patterns to kill

Rule-of-three synonym stacks ("fast, reliable and efficient"), negative parallelism ("not just X, it's Y"),
`-ing` fake-depth tails ("…, streamlining the process"), copula avoidance ("serves as" → "is"), padding
openers ("When it comes to…"), signposting ("Let's dive in"), generic positive endings ("the possibilities
are endless"). Vary sentence rhythm. Have a point of view.

## 6. Claims

Only verifiable claims. Never invent ratings, reviews, testimonials, customer counts or awards.
Competitor facts carry a dated source link. Trademarks are named only in text, never as logos.

## 7. Design rules

These rules were set for OpenPromoter in November 2026.

- **Flat surfaces, one border level.** No decorative gradients or glows on surfaces. Cards on the page
  get a 1px hairline and no shadow. A tinted tile has no border; the UI inside it keeps its hairline.
  White cards on a tinted panel get neither border nor shadow. Floating menus may use a soft shadow.
- **Website primary CTA is the one lit element** (`.btn-primary`): brand blue with a soft inner glow,
  a top highlight and a blue halo. Use it for the main action only. Hero and closing CTAs use size `xl`.
- **Website header is a dark floating bar** in both themes; its menus open as one dark card with it.
  Menu icons have no tile or border and each one names its item (brand marks for integrations).
- **Website pages are white** with cool blue-leaning greys. The app keeps its warm greys.
- **Brand logos** only to show an integration or a share target, monochrome, from Simple Icons (CC0)
  or Phosphor (MIT). Polar and Chargebee come from their own brand kits: Polar in plain black or white, Chargebee in its own orange, as their guides ask. A brand with no permitted mark (Slack) is set as text.
  Never a competitor's logo.
- **App buttons are ink** (black, white in dark mode). Blue in the app is for data, links and the
  current selection. The partner portal uses the founder's brand colour instead.
- **Small radius, never a pill.** 4px tags and badges, 6px controls, 10px cards, 14px panels.
- **Status badges are tinted text** with a 4px radius. No icon inside, no dot, no pill.
- **Icons are outline glyphs with no tile background** (Phosphor regular; fill for the active nav item
  and board column headers). Trends use TrendUp and TrendDown.
- **No serif accent words** in headings. Plain sans headings.
- **No motion.** No animations or transitions anywhere; nothing waits on an animation.
  One exception: the Beacon playground on the home page moves. It stays still with
  reduced motion and still works.
- **No focus or active rings on mouse or touch.** Inputs, selects and composers show focus with a
  neutral border change only, never the brand colour. Keyboard users get a ring through
  `:focus-visible` on buttons and links.
- **Imagery:** real photography (Unsplash License, no credit needed) or AI images the maintainers have
  approved. Product illustrations are built in HTML/SVG from the product's own UI.
- **One accent:** ledger blue #2442F5. Dark mode lightens it to #548DFF at the same hue (OKLCH 263),
  never toward violet, so it stays our blue. The website's primary button stays #2442F5 in both themes.

## 8. Before shipping copy or design

1. Search for `—`: zero hits in delivered copy.
2. Scan new words against §3 and §4.
3. Split any sentence over 25 words.
4. Run the comma linter on every new or changed string.
5. For design changes, send before and after screenshots of each changed area.
