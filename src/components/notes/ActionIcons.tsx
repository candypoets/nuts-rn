import React from 'react';
import { Svg, Path, Circle, type SvgProps } from 'react-native-svg';

type IconProps = SvgProps & {
  color: string;
  filled?: boolean;
  showParticles?: boolean;
};

export function IconReply({ color, ...props }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" fill="none" {...props}>
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconComment({ color, ...props }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" fill="none" {...props}>
      <Path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconRepost({ color, ...props }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" fill="none" {...props}>
      <Path
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconShare({ color, ...props }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" fill="none" {...props}>
      <Path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconLike({
  color,
  filled = false,
  showParticles = false,
  ...props
}: IconProps) {
  const heart =
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

  return (
    <Svg viewBox="0 0 24 24" {...props}>
      <Path
        d={heart}
        stroke={filled ? 'none' : color}
        strokeWidth={2}
        fill={filled ? color : 'none'}
      />
      {showParticles ? (
        <>
          <Circle cx={12} cy={8} r={1.5} fill={color} />
          <Circle cx={16} cy={10} r={1.2} fill={color} />
          <Circle cx={18} cy={14} r={1} fill={color} />
          <Circle cx={16} cy={18} r={1.3} fill={color} />
          <Circle cx={12} cy={20} r={1.1} fill={color} />
          <Circle cx={8} cy={18} r={1.2} fill={color} />
          <Circle cx={6} cy={14} r={1} fill={color} />
          <Circle cx={8} cy={10} r={1.4} fill={color} />
        </>
      ) : null}
    </Svg>
  );
}
