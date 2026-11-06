import * as React from "react";
import { cn } from "./base";

export type BeaconPose =
  | "beacon"
  | "hello"
  | "refers"
  | "payday"
  | "guard"
  | "thinking"
  | "celebrates"
  | "resting";

const BLUE = "#2442f5";
const LIGHT =
  "[--m-body:#e2e7ff] [--m-eye:#0e0f11] [--m-feet:#aab6f2] [--m-shade:#c6cffa] [--m-stem:#aab6f2]";
const GREY = "#9aa3b5";

/** Rounded rect for an arm, rotated around its lower end. */
const Arm = ({ x, y, h, rot, shade }: { x: number; y: number; h: number; rot: number; shade?: boolean }) => (
  <rect
    x={x}
    y={y}
    width={7.5}
    height={h}
    rx={3.75}
    fill={shade ? "var(--m-shade)" : "var(--m-body)"}
    transform={`rotate(${rot} ${x + 3.75} ${y + h})`}
  />
);

/** Tall pill eyes; the shine only shows on the light dark-mode body, where the eyes are dark. */
const Eyes = ({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) => (
  <>
    {[23.4, 35.4].map((x) => (
      <g key={x}>
        <rect x={x + dx} y={28 + dy} width={5.2} height={9} rx={2.6} fill="var(--m-eye)" />
        <circle cx={x + dx + 3.6} cy={30.4 + dy} r={1.1} fill="#fff" className="opacity-0 dark:opacity-100" />
      </g>
    ))}
  </>
);

const HappyEyes = () => (
  <>
    {[23, 35].map((x) => (
      <path
        key={x}
        d={`M${x} 33.5q3-4.5 6 0`}
        fill="none"
        stroke="var(--m-eye)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    ))}
  </>
);

const FACES: Partial<Record<BeaconPose, React.ReactNode>> = {
  payday: <HappyEyes />,
  celebrates: <HappyEyes />,
  thinking: <Eyes dx={-1} dy={-2.2} />,
  refers: <Eyes dx={1.2} />,
  guard: (
    <>
      {[23.4, 35.4].map((x) => (
        <rect key={x} x={x} y={30.5} width={5.2} height={5.6} rx={2.6} fill="var(--m-eye)" />
      ))}
    </>
  ),
  resting: (
    <>
      {[23, 35].map((x) => (
        <rect key={x} x={x} y={32} width={6} height={2.6} rx={1.3} fill="var(--m-eye)" />
      ))}
    </>
  ),
};

/** Drawn behind the body. */
const BEHIND: Partial<Record<BeaconPose, React.ReactNode>> = {
  hello: (
    <>
      <Arm x={45} y={8} h={19} rot={28} />
      <Arm x={6.5} y={33} h={11} rot={-20} shade />
    </>
  ),
  celebrates: (
    <>
      <Arm x={45} y={6} h={19} rot={22} />
      <Arm x={11.5} y={6} h={19} rot={-22} />
    </>
  ),
  payday: <Arm x={6.5} y={33} h={11} rot={-20} shade />,
};

/** Drawn in front of the body. */
const FRONT: Partial<Record<BeaconPose, React.ReactNode>> = {
  refers: (
    <>
      <rect x={51} y={44} width={11} height={11} rx={4.5} fill={BLUE} />
      <rect x={54} y={48} width={1.8} height={3.2} rx={0.9} fill="#fff" />
      <rect x={57.6} y={48} width={1.8} height={3.2} rx={0.9} fill="#fff" />
    </>
  ),
  payday: (
    <>
      <circle cx={52} cy={38} r={8.5} fill={BLUE} />
      <circle cx={52} cy={38} r={6} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} />
      <path
        d="M52 33.6v8.8M54.4 35.4q-.6-1.2-2.4-1.2t-2.4 1.4q0 1.4 2.4 1.9t2.4 1.9q0 1.5-2.4 1.5t-2.6-1.3"
        fill="none"
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </>
  ),
  guard: (
    <>
      <path d="M51 27l9 3.4v6.4q0 7.4-9 10.6q-9-3.2-9-10.6v-6.4z" fill={BLUE} />
      <path
        d="M47.2 37l2.6 2.6 4.8-5"
        fill="none"
        stroke="#fff"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  thinking: (
    <>
      <circle cx={50} cy={16} r={1.8} fill="var(--m-stem)" />
      <circle cx={55} cy={12} r={2.4} fill="var(--m-stem)" />
      <circle cx={60.5} cy={7} r={3} fill="var(--m-stem)" />
    </>
  ),
  celebrates: (
    <>
      <rect x={3} y={12} width={4} height={4} rx={1} fill={BLUE} transform="rotate(20 5 14)" />
      <circle cx={9} cy={4} r={1.8} fill={GREY} />
      <rect x={55} y={3} width={4} height={4} rx={1} fill={GREY} transform="rotate(-15 57 5)" />
      <circle cx={60} cy={15} r={2} fill={BLUE} />
    </>
  ),
  resting: (
    <path
      d="M47 9h6l-6 6h6M55 2h4l-4 4h4"
      fill="none"
      stroke={GREY}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

/**
 * Beacon, the OpenPromoter mascot: an ink body with the logo's blue dot on its antenna. It turns
 * light (Mist) in dark mode so it never disappears. Only for friendly moments, never on money or tax
 * screens, and never in the partner portal, which carries the founder's brand.
 */
export function Beacon({
  pose = "beacon",
  size = 64,
  light = false,
  className,
}: {
  pose?: BeaconPose;
  size?: number;
  /** Always the light (Mist) body, for dark surfaces that stay dark in both themes. */
  light?: boolean;
  className?: string;
}) {
  const clip = React.useId();
  const resting = pose === "resting";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn(
        "shrink-0",
        light
          ? LIGHT
          : "[--m-body:#1a1b20] [--m-eye:#fff] [--m-feet:#0c0d10] [--m-shade:#0c0d10] [--m-stem:#1a1b20]",
        light
          ? ""
          : "dark:[--m-body:#e2e7ff] dark:[--m-eye:#0e0f11] dark:[--m-feet:#aab6f2] dark:[--m-shade:#c6cffa] dark:[--m-stem:#aab6f2]",
        className,
      )}
    >
      {BEHIND[pose]}
      <path
        d="M32 16C32 12 33 9.5 35 7.6"
        fill="none"
        stroke="var(--m-stem)"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      {resting ? null : <circle cx={36} cy={6.6} r={6.4} fill={`${BLUE}33`} />}
      <circle cx={36} cy={6.6} r={3.8} fill={resting ? GREY : BLUE} />
      <rect x={19} y={49} width={8} height={6.5} rx={3.25} fill="var(--m-feet)" />
      <rect x={37} y={49} width={8} height={6.5} rx={3.25} fill="var(--m-feet)" />
      <clipPath id={clip}>
        <rect x={12} y={15} width={40} height={37} rx={17} />
      </clipPath>
      <rect x={12} y={15} width={40} height={37} rx={17} fill="var(--m-body)" />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={32} cy={58.7} rx={30} ry={15.5} fill="var(--m-shade)" opacity={0.55} />
        <ellipse cx={24} cy={20.9} rx={6.4} ry={2.6} fill="#fff" opacity={0.18} />
      </g>
      {FACES[pose] ?? <Eyes />}
      {FRONT[pose]}
    </svg>
  );
}
