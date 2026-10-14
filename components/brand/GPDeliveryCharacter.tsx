import React from 'react';
import Svg, { Circle, Ellipse, G, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme';

interface GPDeliveryCharacterProps {
  /** Rendered width in px; height follows the 96×100 artboard. */
  size?: number;
}

/**
 * The original Govind Pansari delivery scooter — a top-down rider on a
 * scooter with the signature burgundy "G.P." delivery box at the rear.
 * Drawn facing north (up) so a parent can rotate it straight to the
 * rider's real bearing; nothing here animates (the map marker adds
 * motion around it), so this same static artwork can be reused as-is
 * for the order-success, packing and "almost there" moments.
 *
 * Palette is the brand's own tokens — ivory body, deep burgundy
 * rider + box, brown tyres, muted-gold trim. Not a copy of any other
 * delivery app's character.
 */
export function GPDeliveryCharacter({ size = 44 }: GPDeliveryCharacterProps) {
  return (
    <Svg width={size} height={(size * 100) / 96} viewBox="0 0 96 100">
      {/* ground shadow, offset so it reads on the map */}
      <Ellipse cx={50} cy={91} rx={24} ry={5} fill={colors.textPrimary} opacity={0.14} />

      {/* front wheel */}
      <Circle cx={48} cy={18} r={8} fill={colors.textPrimary} />
      <Circle cx={48} cy={18} r={3} fill={colors.gold} />

      {/* scooter body / frame */}
      <Rect x={44} y={24} width={8} height={36} rx={4} fill={colors.surface} stroke={colors.borderStrong} strokeWidth={1} />
      {/* handlebar */}
      <Rect x={34} y={24} width={28} height={3.5} rx={1.75} fill={colors.textPrimary} />

      {/* rider — jacket then helmet with a gold visor */}
      <Ellipse cx={48} cy={50} rx={12} ry={6.5} fill={colors.primaryDark} />
      <Circle cx={48} cy={41} r={7.5} fill={colors.primary} />
      <Rect x={43} y={38.5} width={10} height={3.2} rx={1.6} fill={colors.goldTint} />

      {/* G.P. delivery box — the brand's mark, prominent on the rear carrier */}
      <G>
        <Rect x={29} y={57} width={38} height={24} rx={5} fill={colors.primary} stroke={colors.gold} strokeWidth={1.4} />
        <Rect x={29} y={57} width={38} height={5} rx={2.5} fill={colors.primaryDark} />
        <Rect x={33} y={66.5} width={30} height={0.9} fill={colors.gold} />
        <SvgText
          x={48}
          y={77.5}
          fontSize={11.5}
          fontWeight="700"
          fontFamily="PlayfairDisplay_700Bold"
          fill={colors.goldTint}
          textAnchor="middle"
        >
          G.P.
        </SvgText>
      </G>

      {/* rear wheel */}
      <Circle cx={48} cy={88} r={6.5} fill={colors.textPrimary} />
      <Circle cx={48} cy={88} r={2.6} fill={colors.gold} />
    </Svg>
  );
}
