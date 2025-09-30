import {Component, input, model} from '@angular/core';

@Component({
  selector: 'expansion-panel',
  styleUrl: './expansion-panel.scss',
  exportAs: 'expansionPanel',
  template: `
    <details [open]="opened()" (toggle)="onToggle($event)">
      <summary>
        <ng-content select="expansion-panel-header" />
      </summary>
      <div class="content"><ng-content /></div>
    </details>
  `,
  host: {
    '[class]': '"size-" + size()',
    '[class.is-open]': 'opened()',
  },
})
export class ExpansionPanel {
  readonly opened = model<boolean>(false);
  readonly size = input<'small' | 'medium' | 'large'>();

  protected onToggle(event: Event) {
    const target = event.target as HTMLDetailsElement;
    this.opened.set(target.open);
  }
}
