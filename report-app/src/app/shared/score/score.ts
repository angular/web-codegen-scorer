import {Component, computed, input} from '@angular/core';
import {formatScore} from '../scoring';

@Component({
  selector: 'score',
  styleUrl: 'score.scss',
  template: `
    @if (label()) {
      <span class="label">{{ label() }}</span>
    }
    {{ formattedScore() }}
  `,
  host: {
    '[class]': 'scoreClass() + " " + size()',
  },
})
export class Score {
  readonly total = input.required<number>();
  readonly max = input.required<number>();
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  readonly label = input<string>('');

  protected formattedScore = computed(() => formatScore(this.total(), this.max()));

  protected scoreClass = computed(() => {
    const percentage = this.formattedScore();

    if (percentage >= 98) {
      return 'excellent-score';
    } else if (percentage >= 85) {
      return 'great-score';
    } else if (percentage >= 71) {
      return 'good-score';
    }

    return 'poor-score';
  });
}
