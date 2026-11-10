import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import type { CSSProperties, ReactNode } from "react";

/* Ledger palette (research/design-v2/DIRECTION.md). */
const c = {
  canvas: "#F4F4F1",
  paper: "#FFFFFF",
  ink: "#16171A",
  muted: "#5F6066",
  faint: "#6C6D72", // --text-subtle: 4.8:1 on the canvas, 5.3:1 on paper
  hairline: "#E8E8E4",
  dot: "#D9D9D4",
  accent: "#2442F5",
};
const sans = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const num: CSSProperties = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: "'tnum'" };

/* Dark palette = the app's dark tokens. */
const dark = {
  canvas: "#0C0C0D",
  card: "#131315",
  ink: "#EDEDEE",
  muted: "#A1A1A7",
  faint: "#8D8D94",
  rule: "#2F2F33",
};
const darkRules = (p: string) => `
  ${p}.op-canvas, ${p}.op-canvas > table > tbody > tr > td, ${p}.op-notch { background-color: ${dark.canvas} !important; }
  ${p}.op-card { background-color: ${dark.card} !important; }
  ${p}.op-ink { color: ${dark.ink} !important; }
  ${p}.op-muted { color: ${dark.muted} !important; }
  ${p}.op-faint { color: ${dark.faint} !important; }
  ${p}.op-rule { border-color: ${dark.rule} !important; }
  ${p}.op-tile { background-color: ${dark.ink} !important; color: ${dark.card} !important; }`;

// Apple Mail, iOS and Outlook apps read the media query; Outlook.com tags dark mode with [data-ogsc]/[data-ogsb].
// Gmail strips both and auto-inverts, which the palette survives.
const css = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; width: 100%; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
a[x-apple-data-detectors], #MessageViewBody a { color: inherit !important; text-decoration: none !important; }
@media (prefers-color-scheme: dark) {${darkRules("")}
}${darkRules("[data-ogsc] ")}${darkRules("[data-ogsb] ")}
@media only screen and (max-width: 480px) {
  .op-shell { padding: 20px 12px 32px !important; }
  .op-pad { padding-left: 24px !important; padding-right: 24px !important; }
  .op-head { padding-left: 4px !important; padding-right: 4px !important; }
  .op-h1 { font-size: 20px !important; line-height: 28px !important; }
}`;

/** "#abc" / "#aabbcc" or null. Brand colours come from the database, so anything else falls back. */
function hex(color?: string | null) {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim() ?? "")?.[1];
  if (!h) return null;
  return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
function lum(color: string) {
  return [1, 3, 5]
    .map((i) => {
      const v = Number.parseInt(color.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
}

/** Ink or white, whichever reads better on the brand colour. Either choice clears 4.5:1. */
function textOn(bg: string) {
  return lum(bg) > 0.179 ? c.ink : "#FFFFFF";
}

/**
 * Keeps a brand-coloured surface (button, initial tile) visible on any brand colour:
 * a near-white colour gets a hairline on the white card, a near-black one flips to light in dark mode.
 */
function brandSurface(color: string): { className?: string; border?: string } {
  const l = lum(color);
  if (l < 0.02) return { className: "op-tile" };
  if (l > 0.7) return { border: `1px solid ${c.dot}` };
  return {};
}

/** Outlook for Windows ignores max-width: a ghost 600px table holds the column there. */
function msoColumn(html: string) {
  const open = '<table align="center" width="100%" class="op-shell"';
  const close = "</td></tr></tbody></table><!--/$--></body>";
  if (!html.includes(open) || !html.includes(close)) return html;
  return html
    .replace(
      open,
      `<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->${open}`,
    )
    .replace(close, `<!--[if mso]></td></tr></table><![endif]-->${close}`);
}

function Shell({ title, preview, children }: { title: string; preview: string; children: ReactNode }) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{css}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="op-canvas"
        style={{ backgroundColor: c.canvas, margin: 0, padding: 0, fontFamily: sans }}
      >
        <Container className="op-shell" style={{ maxWidth: 600, width: "100%", padding: "40px 20px 48px" }}>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

/** OpenPromoter's own mark: a PNG (Gmail and Outlook don't show SVG) on its own white tile, so it reads in dark mode. */
export const OPENPROMOTER_LOGO = "https://openpromoter.com/email/openpromoter-logo.png";

function Masthead({ name, logoUrl, color }: { name: string; logoUrl?: string | null; color: string }) {
  const logo = logoUrl || (name === "OpenPromoter" ? OPENPROMOTER_LOGO : null);
  return (
    <Section className="op-head" style={{ padding: "0 8px 20px" }}>
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
        <tbody>
          <tr>
            {logo ? (
              <td style={{ height: 24, lineHeight: 0 }}>
                <Img src={logo} alt="" height={24} style={{ height: 24, width: "auto", display: "block" }} />
              </td>
            ) : (
              <td
                className={brandSurface(color).className}
                width={22}
                height={22}
                align="center"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: brandSurface(color).border,
                  backgroundColor: color,
                  color: textOn(color),
                  fontFamily: sans,
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: "22px",
                }}
              >
                {name.trim().charAt(0).toUpperCase()}
              </td>
            )}
            {/* the name always shows: a logo alone can be a favicon nobody recognises */}
            <td
              className="op-ink"
              style={{ paddingLeft: 10, fontFamily: sans, fontSize: 14, fontWeight: 500, color: c.ink }}
            >
              {name}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <Section className="op-card" style={{ backgroundColor: c.paper, borderRadius: 10 }}>
      {children}
    </Section>
  );
}

const pad = (top: number, bottom: number): CSSProperties => ({ padding: `${top}px 32px ${bottom}px` });

function Title({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      className="op-ink op-h1"
      style={{
        margin: 0,
        fontFamily: sans,
        fontSize: 22,
        lineHeight: "30px",
        fontWeight: 500,
        letterSpacing: "-0.3px",
        color: c.ink,
      }}
    >
      {children}
    </Heading>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Text
      className="op-faint"
      style={{
        margin: "0 0 8px",
        fontFamily: sans,
        fontSize: 12,
        lineHeight: "16px",
        fontWeight: 500,
        color: c.faint,
      }}
    >
      {children}
    </Text>
  );
}

/** Statement line: label, dotted leader, right-aligned figure. */
function LedgerLine({ label, value, total }: { label: string; value: string; total?: boolean }) {
  const cell: CSSProperties = { fontFamily: sans, verticalAlign: "bottom", whiteSpace: "nowrap" };
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td
            className={total ? "op-ink" : "op-muted"}
            style={{
              ...cell,
              padding: "5px 0",
              fontSize: 14,
              lineHeight: "20px",
              fontWeight: total ? 500 : 400,
              color: total ? c.ink : c.muted,
            }}
          >
            {label}
          </td>
          <td
            style={{ width: "100%", padding: total ? "0 12px 11px" : "0 10px 10px", verticalAlign: "bottom" }}
          >
            <div
              className="op-rule"
              style={{ borderBottom: `1px dotted ${c.dot}`, height: 1, lineHeight: "1px", fontSize: 1 }}
            >
              &nbsp;
            </div>
          </td>
          <td
            className="op-ink"
            align="right"
            style={{
              ...cell,
              ...num,
              padding: "5px 0",
              textAlign: "right",
              fontSize: total ? 24 : 14,
              lineHeight: total ? "30px" : "20px",
              fontWeight: 500,
              letterSpacing: total ? "-0.4px" : 0,
              color: c.ink,
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Tear line across the full card: canvas-coloured notches cut into both edges, dashed rule between. */
function Perforation() {
  const notch = (side: "left" | "right"): CSSProperties => ({
    width: 12,
    height: 24,
    backgroundColor: c.canvas,
    borderRadius: side === "left" ? "0 12px 12px 0" : "12px 0 0 12px",
  });
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td className="op-notch" width={12} style={notch("left")} />
          <td style={{ padding: "0 12px" }}>
            <div
              className="op-rule"
              style={{ borderTop: `1px dashed ${c.dot}`, height: 1, lineHeight: "1px", fontSize: 1 }}
            >
              &nbsp;
            </div>
          </td>
          <td className="op-notch" width={12} style={notch("right")} />
        </tr>
      </tbody>
    </table>
  );
}

function Action({ href, label, color }: { href: string; label: string; color: string }) {
  const surface = brandSurface(color);
  return (
    <Button
      href={href}
      className={surface.className}
      style={{
        backgroundColor: color,
        color: textOn(color),
        border: surface.border,
        borderRadius: 6,
        padding: "12px 20px",
        fontFamily: sans,
        fontSize: 14,
        lineHeight: "20px",
        fontWeight: 500,
        textDecoration: "none",
      }}
    >
      {label}
    </Button>
  );
}

/** Plain URL under the button for clients that block or mangle it. */
function Fallback({ href }: { href: string }) {
  return (
    <Section className="op-pad op-rule" style={{ ...pad(18, 22), borderTop: `1px solid ${c.hairline}` }}>
      <Text
        className="op-faint"
        style={{ margin: 0, fontFamily: sans, fontSize: 12, lineHeight: "18px", color: c.faint }}
      >
        Button not working? Paste this link into your browser:
      </Text>
      <Link
        href={href}
        className="op-muted"
        style={{
          display: "block",
          marginTop: 4,
          fontFamily: mono,
          fontSize: 12,
          lineHeight: "18px",
          color: c.muted,
          textDecoration: "underline",
          wordBreak: "break-all",
        }}
      >
        {href}
      </Link>
    </Section>
  );
}

const footText: CSSProperties = {
  margin: "0 0 4px",
  fontFamily: sans,
  fontSize: 12,
  lineHeight: "18px",
  color: c.faint,
};

/** Why you got this, then the links line. */
function Footer({ reason, links }: { reason: string; links: ReactNode }) {
  return (
    <Section className="op-head" style={{ padding: "20px 8px 0" }}>
      <Text className="op-faint" style={footText}>
        {reason}
      </Text>
      <Text className="op-faint" style={footText}>
        {links}
      </Text>
    </Section>
  );
}

const footLink: CSSProperties = { color: c.faint, textDecoration: "underline" };

const poweredBy = (
  <Link href="https://openpromoter.com" className="op-faint" style={footLink}>
    Powered by OpenPromoter
  </Link>
);

export interface LedgerRow {
  label: string;
  value: string;
}

export interface NoticeProps {
  brandName: string;
  brandColor?: string;
  logoUrl?: string | null;
  preview: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  footer?: string;
  /** Optional statement block for mail about money. `total` sits below a perforated tear line. */
  ledger?: { rows: LedgerRow[]; total?: LedgerRow };
  /** Optional emails carry a one-click unsubscribe link in the footer. */
  unsubscribeUrl?: string;
}

export function Notice({
  brandName,
  brandColor,
  logoUrl,
  preview,
  title,
  paragraphs,
  cta,
  footer,
  ledger,
  unsubscribeUrl,
}: NoticeProps) {
  const color = hex(brandColor) ?? c.accent;
  const rows = ledger?.rows ?? [];
  const body = paragraphs.filter((p) => p.trim());
  return (
    // an empty preheader would let clients show the masthead text as the preview
    <Shell title={title} preview={preview.trim() || body[0] || title}>
      <Masthead name={brandName} logoUrl={logoUrl} color={color} />
      <Card>
        <Section className="op-pad" style={pad(32, 0)}>
          <Title>{title}</Title>
          {body.map((p, i) => (
            <Text
              key={i}
              className="op-muted"
              style={{
                margin: "10px 0 0",
                fontFamily: sans,
                fontSize: 15,
                lineHeight: "24px",
                color: c.muted,
                whiteSpace: "pre-line",
                // long URLs in the copy would otherwise push the card past a phone's width
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {p}
            </Text>
          ))}
        </Section>
        {rows.length ? (
          <Section className="op-pad" style={pad(22, ledger?.total ? 14 : 0)}>
            {rows.map((r) => (
              <LedgerLine key={r.label} label={r.label} value={r.value} />
            ))}
          </Section>
        ) : null}
        {ledger?.total ? (
          <>
            {rows.length ? <Perforation /> : null}
            <Section className="op-pad" style={pad(rows.length ? 12 : 22, 0)}>
              <LedgerLine label={ledger.total.label} value={ledger.total.value} total />
            </Section>
          </>
        ) : null}
        {cta ? (
          <>
            <Section className="op-pad" style={pad(28, 32)}>
              <Action href={cta.href} label={cta.label} color={color} />
            </Section>
            <Fallback href={cta.href} />
          </>
        ) : (
          <Section style={{ height: 32 }} />
        )}
      </Card>
      <Footer
        reason={footer ?? `Sent by ${brandName}. If this wasn't meant for you, you can ignore it.`}
        links={
          <>
            {unsubscribeUrl ? (
              <>
                <Link href={unsubscribeUrl} className="op-faint" style={footLink}>
                  Unsubscribe
                </Link>
                {"  ·  "}
              </>
            ) : null}
            {brandName === "OpenPromoter" ? (
              <Link href="https://openpromoter.com" className="op-faint" style={footLink}>
                openpromoter.com
              </Link>
            ) : (
              poweredBy
            )}
          </>
        }
      />
    </Shell>
  );
}

export interface ReportProps {
  brandName: string;
  periodLabel: string;
  stats: { label: string; value: string; delta?: string }[];
  highlights: string[];
  nextSteps: string[];
  dashboardUrl: string;
  unsubscribeUrl?: string;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Report({
  brandName,
  periodLabel,
  stats,
  highlights,
  nextSteps,
  dashboardUrl,
  unsubscribeUrl,
}: ReportProps) {
  const [lead, ...rest] = stats;
  const settings = `${dashboardUrl.replace(/\/+$/, "")}/analytics`;
  const listText: CSSProperties = { fontFamily: sans, fontSize: 14, lineHeight: "20px", color: c.ink };
  return (
    <Shell
      title={`${brandName} partner program report`}
      preview={lead ? `${sentence(lead.label)}: ${lead.value}. ${periodLabel}.` : `${periodLabel}.`}
    >
      <Masthead name={brandName} color={c.ink} />
      <Card>
        <Section className="op-pad" style={pad(28, 0)}>
          <Label>{periodLabel}</Label>
          <Title>Partner program report</Title>
        </Section>
        {lead ? (
          <Section className="op-pad" style={pad(24, 0)}>
            <Text
              className="op-ink"
              style={{
                ...num,
                margin: 0,
                fontFamily: sans,
                fontSize: 36,
                lineHeight: "42px",
                fontWeight: 500,
                letterSpacing: "-1px",
                color: c.ink,
              }}
            >
              {lead.value}
            </Text>
            <Text
              className="op-muted"
              style={{
                margin: "4px 0 0",
                fontFamily: sans,
                fontSize: 14,
                lineHeight: "20px",
                color: c.muted,
              }}
            >
              {sentence(lead.label)}
              {lead.delta ? (
                <span className="op-faint" style={{ color: c.faint }}>
                  {" "}
                  · {lead.delta}
                </span>
              ) : null}
            </Text>
          </Section>
        ) : null}
        {rest.length ? (
          <Section className="op-pad" style={pad(20, 0)}>
            {rest.map((s) => (
              <LedgerRowWithDelta key={s.label} label={sentence(s.label)} value={s.value} delta={s.delta} />
            ))}
          </Section>
        ) : null}
        {highlights.length ? (
          <Section className="op-pad" style={pad(28, 0)}>
            <Label>What earned money</Label>
            {highlights.map((h, i) => (
              <Text
                key={i}
                className="op-ink op-rule"
                style={{ ...listText, margin: 0, padding: "9px 0", borderTop: `1px solid ${c.hairline}` }}
              >
                {h}
              </Text>
            ))}
          </Section>
        ) : null}
        {nextSteps.length ? (
          <Section className="op-pad" style={pad(24, 0)}>
            <Label>What to do next</Label>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
              <tbody>
                {nextSteps.map((s, i) => (
                  <tr key={i}>
                    <td
                      className="op-faint op-rule"
                      style={{
                        ...num,
                        width: 28,
                        padding: "9px 0",
                        verticalAlign: "top",
                        borderTop: `1px solid ${c.hairline}`,
                        fontFamily: mono,
                        fontSize: 12,
                        lineHeight: "20px",
                        color: c.faint,
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td
                      className="op-ink op-rule"
                      style={{ ...listText, padding: "9px 0", borderTop: `1px solid ${c.hairline}` }}
                    >
                      {s}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}
        <Section className="op-pad" style={pad(28, 32)}>
          <Action href={dashboardUrl} label="Open dashboard" color={c.accent} />
        </Section>
        <Fallback href={dashboardUrl} />
      </Card>
      <Footer
        reason={`You get this because partner reports for ${brandName} are sent to this address.`}
        links={
          <>
            <Link href={settings} className="op-faint" style={footLink}>
              Report settings
            </Link>
            {"  ·  "}
            {unsubscribeUrl ? (
              <>
                <Link href={unsubscribeUrl} className="op-faint" style={footLink}>
                  Unsubscribe
                </Link>
                {"  ·  "}
              </>
            ) : null}
            {poweredBy}
          </>
        }
      />
    </Shell>
  );
}

function LedgerRowWithDelta({ label, value, delta }: LedgerRow & { delta?: string }) {
  return (
    <>
      <LedgerLine label={label} value={value} />
      {delta ? (
        <Text
          className="op-faint"
          style={{
            ...num,
            margin: "-3px 0 4px",
            fontFamily: sans,
            fontSize: 12,
            lineHeight: "16px",
            color: c.faint,
          }}
        >
          {delta}
        </Text>
      ) : null}
    </>
  );
}

export const renderNotice = (p: NoticeProps) => render(<Notice {...p} />).then(msoColumn);
export const renderReport = (p: ReportProps) => render(<Report {...p} />).then(msoColumn);

/* Plain-text parts carry the amounts and the button's link too, for clients and filters that read text. */
const lines = (rows: LedgerRow[]) => rows.map((r) => `${r.label}: ${r.value}`);
const block = (...parts: (string | string[] | false | 0 | undefined)[]) =>
  parts
    .flat()
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join("\n\n");

export function noticeText(p: NoticeProps) {
  const ledger = p.ledger ? [...lines(p.ledger.rows), ...lines(p.ledger.total ? [p.ledger.total] : [])] : [];
  return block(
    p.title,
    p.paragraphs,
    ledger.join("\n"),
    p.cta && `${p.cta.label}: ${p.cta.href}`,
    p.footer ?? `Sent by ${p.brandName}. If this wasn't meant for you, you can ignore it.`,
    p.unsubscribeUrl && `Unsubscribe: ${p.unsubscribeUrl}`,
  );
}

export function reportText(p: ReportProps) {
  return block(
    `${p.brandName} partner program report. ${p.periodLabel}.`,
    p.stats.map((s) => `${sentence(s.label)}: ${s.value}${s.delta ? ` (${s.delta})` : ""}`).join("\n"),
    p.highlights.length && ["What earned money:", ...p.highlights.map((h) => `- ${h}`)].join("\n"),
    p.nextSteps.length && ["What to do next:", ...p.nextSteps.map((x, i) => `${i + 1}. ${x}`)].join("\n"),
    `Open dashboard: ${p.dashboardUrl}`,
    p.unsubscribeUrl && `Unsubscribe: ${p.unsubscribeUrl}`,
  );
}
