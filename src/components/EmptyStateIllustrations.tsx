import React from 'react';
import Svg, {Circle, G, Path, Rect, type SvgProps} from 'react-native-svg';

type EmptyStateIllustrationProps = SvgProps & {
  height?: number;
  width?: number;
};

const OUTLINE = '#1f2937';
const TEAL = '#137568';
const MINT = '#1fb092';
const LAVENDER = '#9f7aea';
const AMBER = '#f59e0b';
const OFF_WHITE = '#f8fafc';

export function WalletEmptyIllustration({
  height = 138,
  width = 184,
  ...props
}: EmptyStateIllustrationProps) {
  return (
    <Svg
      accessibilityLabel="Wallet with a pass and ticket"
      accessible
      height={height}
      viewBox="0 0 240 180"
      width={width}
      {...props}
    >
      <Path
        d="M31 100c2-39 31-72 72-79 42-8 94 3 112 37 18 35-1 79-36 96-34 17-86 13-118-5-23-13-32-29-30-49Z"
        fill="#dff5ec"
      />
      <G transform="rotate(-4 128 92)">
        <Path
          d="M149 32h49c5 0 9 4 9 9v23c-8 0-8 14 0 14v29c0 5-4 9-9 9h-49V78c8 0 8-14 0-14V32Z"
          fill={AMBER}
          stroke={OUTLINE}
          strokeLinejoin="round"
          strokeWidth={5}
        />
        <Path
          d="M179 45v58"
          stroke={OFF_WHITE}
          strokeDasharray="6 7"
          strokeLinecap="round"
          strokeWidth={4}
        />
        <Rect
          fill={LAVENDER}
          height={85}
          rx={11}
          stroke={OUTLINE}
          strokeWidth={5}
          width={69}
          x={102}
          y={36}
        />
        <Circle cx={121} cy={56} fill={OFF_WHITE} r={7} />
        <Path
          d="M136 53h22M115 73h43M115 86h30"
          stroke={OFF_WHITE}
          strokeLinecap="round"
          strokeWidth={5}
        />
        <Path
          d="M49 76c0-8 7-15 15-15h97c11 0 20 9 20 20v65H67c-10 0-18-8-18-18V76Z"
          fill={TEAL}
          stroke={OUTLINE}
          strokeLinejoin="round"
          strokeWidth={6}
        />
        <Path
          d="M50 82c0-10 8-18 18-18h97c9 0 16 7 16 16v13H68c-10 0-18-5-18-11Z"
          fill={OFF_WHITE}
          stroke={OUTLINE}
          strokeLinejoin="round"
          strokeWidth={5}
        />
        <Path
          d="M142 94h49c8 0 14 6 14 14v19c0 8-6 14-14 14h-49c-13 0-23-10-23-23v-1c0-13 10-23 23-23Z"
          fill={MINT}
          stroke={OUTLINE}
          strokeLinejoin="round"
          strokeWidth={5}
        />
        <Circle cx={144} cy={118} fill={AMBER} r={7} stroke={OUTLINE} strokeWidth={4} />
      </G>
      <Circle cx={49} cy={51} fill={MINT} r={12} stroke={OUTLINE} strokeWidth={5} />
      <Circle cx={81} cy={30} fill={AMBER} r={8} stroke={OUTLINE} strokeWidth={4} />
      <Circle cx={32} cy={72} fill={LAVENDER} r={6} />
    </Svg>
  );
}

export function ChatEmptyIllustration({
  height = 138,
  width = 184,
  ...props
}: EmptyStateIllustrationProps) {
  return (
    <Svg
      accessibilityLabel="Two conversation bubbles"
      accessible
      height={height}
      viewBox="0 0 240 180"
      width={width}
      {...props}
    >
      <Path
        d="M29 92c0-39 29-70 70-77 43-8 94 6 112 40 18 35-3 79-40 96-35 16-88 11-118-8-18-12-24-30-24-51Z"
        fill="#eee9fa"
      />
      <Path
        d="M45 39h103c12 0 22 10 22 22v42c0 12-10 22-22 22h-53l-24 18 5-18H45c-12 0-22-10-22-22V61c0-12 10-22 22-22Z"
        fill={MINT}
        stroke={OUTLINE}
        strokeLinejoin="round"
        strokeWidth={6}
      />
      <Circle cx={58} cy={74} fill={OFF_WHITE} r={10} stroke={OUTLINE} strokeWidth={4} />
      <Path
        d="M79 72h54M79 90h36"
        stroke={OFF_WHITE}
        strokeLinecap="round"
        strokeWidth={6}
      />
      <Path
        d="M97 73h99c12 0 21 9 21 21v38c0 12-9 21-21 21h-22l8 18-29-18H97c-12 0-21-9-21-21V94c0-12 9-21 21-21Z"
        fill={LAVENDER}
        stroke={OUTLINE}
        strokeLinejoin="round"
        strokeWidth={6}
      />
      <Circle cx={116} cy={113} fill={OFF_WHITE} r={7} />
      <Circle cx={145} cy={113} fill={AMBER} r={7} />
      <Circle cx={174} cy={113} fill={MINT} r={7} />
      <Path
        d="M35 151c10 7 20 10 32 9"
        fill="none"
        stroke={AMBER}
        strokeLinecap="round"
        strokeWidth={6}
      />
      <Circle cx={28} cy={144} fill={AMBER} r={5} />
      <Circle cx={211} cy={57} fill={MINT} r={6} />
    </Svg>
  );
}
