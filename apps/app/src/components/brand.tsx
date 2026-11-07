import { type ReactElement, type ReactNode, type SVGProps, useId } from "react";

/*
 * Brand marks, shown only to say what OpenPromoter connects to or pays out through. Each name is a
 * trademark of its owner. Same marks as the website (openpromoter-site components/brand.tsx): Simple
 * Icons (CC0-1.0) at 24px; Polar and Chargebee from their own brand kits, Polar in the text colour and
 * Chargebee in its own orange as their guides ask.
 */
type P = SVGProps<SVGSVGElement> & { size?: number; mono?: boolean };
type Mark = (props: P) => ReactElement;

const PATHS = {
  Stripe:
    "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z",
  PayPal:
    "M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z",
  Wise: "M6.488 7.469 0 15.05h11.585l1.301-3.576H7.922l3.033-3.507.01-.092L8.993 4.48h8.873l-6.878 18.925h4.706L24 .595H2.543l3.945 6.874Z",
  Paddle:
    "M2.363 7.904v.849a3.95 3.95 0 0 1 3.65 2.425c.198.476.3.987.299 1.502h.791c0-1.04.416-2.037 1.157-2.772a3.962 3.962 0 0 1 2.792-1.149V7.91a3.959 3.959 0 0 1-3.65-2.425 3.893 3.893 0 0 1-.299-1.502h-.791c0 1.04-.416 2.037-1.157 2.772a3.96 3.96 0 0 1-2.792 1.149M13.105 2.51H6.312V0h6.793c4.772 0 8.532 3.735 8.532 8.314 0 4.58-3.76 8.314-8.532 8.314H9.156V24H6.312v-9.882h6.793c3.319 0 5.688-2.352 5.688-5.804 0-3.451-2.37-5.804-5.688-5.804",
  LemonSqueezy:
    "m7.4916 10.835 2.3748-6.5114a3.1497 3.1497 0 0 0-.065-2.3418C9.0315.183 6.9427-.398 5.2928.265 3.643.929 2.71 2.4348 3.512 4.3046l2.8197 6.5615c.219.509.97.489 1.16-.03m1.6798 1.0969 6.5334-2.7758c2.1699-.9219 2.7218-3.6907 1.022-5.2905l-.068-.063c-1.6669-1.5469-4.4217-1.002-5.3706 1.0359L8.3566 11.135c-.234.503.295 1.0199.8159.7979m.373.87 6.6454-2.5119c2.2078-.8349 4.6206.745 4.5886 3.0398l-.002.09c-.048 2.2358-2.3938 3.7376-4.5536 2.9467l-6.6724-2.4418a.595.595 0 0 1-.006-1.1229m-.386 1.9269 6.4375 2.9767a3.2997 3.2997 0 0 1 1.6658 1.6989c.769 1.7998-.283 3.6396-1.9328 4.3016-1.6499.662-3.4097.235-4.2097-1.6359l-2.8027-6.5694c-.217-.509.328-1.009.8419-.772",
} as const;

function simple(name: keyof typeof PATHS): Mark {
  return ({ size = 16, mono: _mono, ...rest }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const StripeMark = simple("Stripe");
export const PayPalMark = simple("PayPal");
export const WiseMark = simple("Wise");
export const PaddleMark = simple("Paddle");
export const LemonSqueezyMark = simple("LemonSqueezy");

/** Polar's logomark from its brand kit, in the current text colour. */
export const PolarMark: Mark = ({ size = 16, mono: _mono, ...rest }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 1510 1510" width={size} height={size} fill="currentColor" aria-hidden="true" {...rest}>
      <mask
        id={id}
        style={{ maskType: "alpha" }}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="1510"
        height="1510"
      >
        <circle cx="755" cy="755" r="755" fill="#fff" />
      </mask>
      <g mask={`url(#${id})`}>
        <path d="M679.51 -81.6641V571.332L232.436 124.258L123.483 233.21L570.558 680.285H-449.15V834.366H570.515L159.337 1245.55L268.291 1354.5L679.51 943.277V1553.91H833.592V-81.6641H679.51Z" />
        <path d="M1189.51 757.326C1189.51 550.283 1290.75 361.31 1444.36 246.645L1342.97 110.824C1147.75 256.556 1020.02 495.271 1020.02 757.326C1020.02 985.231 1118.44 1184.81 1268.48 1329L1370.05 1432.88L1491.24 1314.39L1387.8 1208.6L1386.79 1207.63C1265.9 1091.86 1189.51 934.764 1189.51 757.326Z" />
      </g>
    </svg>
  );
};

/** Chargebee's symbol from its brand kit, in its own orange, or one colour with `mono` (the menus). */
export const ChargebeeMark: Mark = ({ size = 16, mono, ...rest }) => (
  <svg
    viewBox="0 0 41 40"
    width={size}
    height={size}
    fill={mono ? "currentColor" : "#ff3300"}
    aria-hidden="true"
    {...rest}
  >
    <path d="M13.897 19.9923L40.3176 13.7024V0H26.6152L13.897 19.9923Z" />
    <path d="M0.793945 19.7618C0.793945 21.4074 0.993868 22.9914 1.37834 24.5139L13.8966 19.9925L1.27068 15.4404C0.963111 16.8245 0.793945 18.2701 0.793945 19.7464L0.793945 19.7618Z" />
    <path d="M5.4541 7.01271L13.897 19.9923L17.7878 0.18457C12.8666 0.876612 8.52984 3.38334 5.46948 7.01271H5.4541Z" />
    <path d="M13.897 19.9922L40.3176 26.2975V39.9999H26.6152L13.897 19.9922Z" />
    <path d="M5.4541 32.9718L13.897 19.9922L17.7878 39.8C12.8666 39.1079 8.52984 36.6012 5.46948 32.9718H5.4541Z" />
  </svg>
);

/** Provider or payout method id to its mark and brand colour (black-and-white brands use the text colour). */
export const BRANDS: Record<string, { mark: Mark; color: string }> = {
  stripe: { mark: StripeMark, color: "text-[#635bff]" },
  paypal: { mark: PayPalMark, color: "text-[#003087] dark:text-[#5b8def]" },
  wise: { mark: WiseMark, color: "text-fg" },
  paddle: { mark: PaddleMark, color: "text-fg" },
  lemonsqueezy: { mark: LemonSqueezyMark, color: "text-[#ffc233]" },
  polar: { mark: PolarMark, color: "text-fg" },
  chargebee: { mark: ChargebeeMark, color: "" },
};

/** A brand's mark in its colour, or nothing for an unknown id. */
export function BrandIcon({
  brand,
  size = 16,
  className = "",
}: {
  brand: string;
  size?: number;
  className?: string;
}) {
  const b = BRANDS[brand];
  if (!b) return null;
  const M = b.mark;
  return <M size={size} className={`shrink-0 ${b.color} ${className}`} />;
}

/** A card title with the brand's mark before the name. */
export function BrandTitle({ brand, children }: { brand: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandIcon brand={brand} size={16} />
      {children}
    </span>
  );
}
