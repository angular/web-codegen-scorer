import {isPlatformServer} from '@angular/common';
import {ScoreBucket} from '../../../../runner/shared-interfaces';
import {ColorMode} from '../services/app-color-mode';

export enum ScoreCssVariable {
  excellent = 'var(--status-fill-excellent)',
  great = 'var(--status-fill-great)',
  good = 'var(--status-fill-good)',
  poor = 'var(--status-fill-poor)',
  neutral = 'var(--status-fill-neutral)',
}

const CACHED_COLORS = {
  light: {} as Record<string, string>,
  dark: {} as Record<string, string>,
};

export function bucketToScoreVariable(bucket: ScoreBucket): ScoreCssVariable {
  const min = bucket.min;

  if (min >= 98) {
    return ScoreCssVariable.excellent;
  } else if (min >= 85) {
    return ScoreCssVariable.great;
  } else if (min >= 71) {
    return ScoreCssVariable.good;
  }

  return ScoreCssVariable.poor;
}

export function getHardcodedColor(
  platformId: Object,
  color: `var(${string})`,
  colorMode: ColorMode,
): string {
  const varName = getValueInParens(color);

  // We can't calculate the colors on the server.
  if (isPlatformServer(platformId) || varName === null) {
    return 'transparent';
  }

  if (!CACHED_COLORS[colorMode][varName]) {
    const computed = window.getComputedStyle(document.body).getPropertyValue(varName);
    let value: string;

    if (computed.startsWith('light-dark')) {
      const inner = getValueInParens(computed) || 'transparent, transparent';
      value = inner.split(',').map(part => part.trim())[colorMode === 'light' ? 0 : 1];
    } else {
      value = computed;
    }

    CACHED_COLORS[colorMode][varName] = value;
  }

  console.log(CACHED_COLORS);

  return CACHED_COLORS[colorMode][varName];
}

export function formatScore(total: number, maximum: number): number {
  return Math.round((total / maximum) * 100) || 0;
}

function getValueInParens(value: string): string | null {
  return value.match(/\((.*)\)/)?.[1] || null;
}
