import React from 'react';
import { Image } from 'expo-image';

interface MonogramProps {
  size?: number;
  onDark?: boolean;
}

const LOGO = require('../../assets/brand/monogram-gold.png');
const LOGO_ON_LIGHT = require('../../assets/brand/monogram-maroon.png');

/**
 * The official Govind Pansari logo — a self-contained circular seal
 * (GP monogram + "Govind Pansari · Est. 1950 · Agra" wordmark, gold on
 * deep burgundy) that reads correctly on any background, so there's no
 * separate light/dark artwork the way the old outline-style mark
 * needed. `onDark` is kept so every existing call site keeps working
 * unchanged; both source files are currently the same image.
 */
export function Monogram({ size = 88, onDark = true }: MonogramProps) {
  return (
    <Image
      source={onDark ? LOGO : LOGO_ON_LIGHT}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}
