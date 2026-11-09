import { Beacon, type BeaconPose } from "@openpromoter/ui";

export type SceneKind = "signin" | "signup";

// ponytail: illustrative figures for the auth panel, not live data
const RUN: [string, string, string, "Paid" | "Approved" | "Held"][] = [
  ["MC", "Maya Chen", "$1,240.00", "Paid"],
  ["LM", "Leo Martins", "$980.00", "Paid"],
  ["NL", "Nora Lindqvist", "$412.50", "Approved"],
  ["EP", "Ethan Park", "$96.00", "Held"],
];
const TONE = {
  Paid: "bg-[#3ecf8e]/14 text-[#6ee7b0]",
  Approved: "bg-[#548dff]/16 text-[#8fb7ff]",
  Held: "bg-[#f5b544]/14 text-[#f7c96b]",
} as const;

const STEPS: [string, string, boolean][] = [
  ["Connect Stripe", "A restricted key. Read only.", true],
  ["Your program, designed", "30% recurring for 12 months · 60-day cookie", true],
  ["Invite your first partners", "Drafted for your best customers", false],
];

const CARD = "rounded-[12px] bg-[#16171a]";

/** A scene from the product on the ink panel, with Beacon standing on the card's top edge. */
export function AuthScene({ kind, pose }: { kind: SceneKind; pose: BeaconPose }) {
  return (
    <div className="relative w-full max-w-[420px] pt-14 select-none">
      <Beacon pose={pose} size={72} light className="absolute top-0 right-8" />
      {kind === "signin" ? <PayoutRun /> : <Setup />}
    </div>
  );
}

function PayoutRun() {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
        <span className="text-[13px] font-medium">November payout run</span>
        <span className="num text-[12px] text-white/50">Nov 1</span>
      </div>
      <ul className="px-5 py-2">
        {RUN.map(([ini, name, amt, st]) => (
          <li key={name} className="flex items-center gap-3 py-2.5 text-[13px]">
            <span className="flex size-7 items-center justify-center rounded-full bg-white/8 text-[10px] font-medium text-white/80">
              {ini}
            </span>
            <span className="text-white/85">{name}</span>
            <span className="num ml-auto">{amt}</span>
            <span
              className={`inline-flex h-[18px] w-[62px] items-center justify-center rounded-[4px] text-[11px] font-medium ${TONE[st]}`}
            >
              {st}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-white/8 px-5 py-3.5">
        <span className="text-[12px] text-white/55">Through your Stripe account</span>
        <span className="text-[12px] text-white/55">
          OpenPromoter fee <span className="num ml-1 text-[15px] font-medium text-white">$0.00</span>
        </span>
      </div>
    </div>
  );
}

function Setup() {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
        <span className="text-[13px] font-medium">Set up your program</span>
        <span className="num text-[12px] text-white/50">2 of 3 done</span>
      </div>
      <ol className="px-5 py-3">
        {STEPS.map(([t, d, done], i) => (
          <li key={t} className="flex gap-3 py-2.5">
            <span
              className={`num mt-px flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[12px] font-medium ${done ? "bg-[#2442f5] text-white" : "text-white/70 ring-1 ring-white/20"}`}
            >
              {done ? (
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="min-w-0">
              <span className={`block text-[13px] ${done ? "text-white/85" : "font-medium text-white"}`}>
                {t}
              </span>
              <span className="block text-[12px] text-white/50">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="border-t border-white/8 px-5 py-3.5 text-[12px] text-white/55">
        Free plan up to $1k a month of partner revenue. No card needed.
      </div>
    </div>
  );
}
