import {Component, computed, input} from '@angular/core';

const exactMatches: Record<string, string> = {
  angular: 'frameworks/angular.png',
  react: 'frameworks/react.webp',
  next: 'frameworks/nextjs.svg',
  vue: 'frameworks/vue.svg',
  solid: 'frameworks/solid.svg',
  'gemini-cli': 'gemini.webp',
  genkit: 'genkit.png',
  codex: 'open-ai.png',
};

@Component({
  selector: 'provider-label',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
    }

    :host(.small) {
      font-size: 0.75rem;
    }

    .logo {
      width: 24px;
      height: 24px;
    }

    :host-context(.dark-mode) :host(.genkit) .logo {
      filter: invert(1);
    }
  `,
  template: `
    @let logo = this.logo();

    @if (logo) {
      <img class="logo" [src]="logo" />
    }

    {{ label() }}
  `,
  host: {
    '[class]': 'id()',
    '[class.small]': 'size() === "small"',
  },
})
export class ProviderLabel {
  readonly id = input<string>();
  readonly label = input.required<string>();
  readonly size = input<'small' | 'medium'>('medium');

  protected logo = computed(() => {
    const id = this.id();

    if (!id) {
      return null;
    }

    return exactMatches.hasOwnProperty(id) ? exactMatches[id] : getModelLogoURL(id);
  });
}

function getModelLogoURL(id: string): string | null {
  if (id.startsWith('gemini')) {
    return 'gemini.webp';
  } else if (id.startsWith('openai')) {
    return 'open-ai.png';
  } else if (id.startsWith('claude')) {
    return 'claude.png';
  }

  return null;
}
