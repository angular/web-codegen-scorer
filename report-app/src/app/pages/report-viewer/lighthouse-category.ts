import {Component, input} from '@angular/core';
import {LighthouseAudit} from '../../../../../runner/workers/serve-testing/worker-types';
import {Score} from '../../shared/score/score';

@Component({
  selector: 'lighthouse-category',
  imports: [Score],
  template: `
    @let audits = this.audits();
    @let score = this.score();

    <h4>
      @if (score != null) {
        <score size="small" [total]="score" [max]="1"/>
      }
      {{displayName()}}
    </h4>

    @if (description()) {
      <p>{{description()}}</p>
    }

    <ul>
      @for (audit of audits; track audit.id) {
        <li>
          @if (audit.score != null) {
            <score size="tiny" [total]="audit.score" [max]="1"/>
          }
          {{audit.title}}{{audit.displayValue ? ': ' + audit.displayValue : ''}}

          @if (audit.description) {
            <span
              class="material-symbols-outlined has-tooltip multiline-tooltip"
              [attr.data-tooltip]="audit.description">info</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }

    h4 {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 0.5rem;
      margin: 1rem 0 0.5rem 0;
    }

    ul {
      display: flex;
      flex-direction: column;
      list-style: none;
      padding: 0 0 0 4px;
      gap: 0.5rem;
      margin: 0;
    }

    li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
})
export class LighthouseCategory {
  readonly audits = input.required<LighthouseAudit[]>();
  readonly displayName = input.required<string>();
  readonly score = input.required<number | null>();
  readonly description = input<string>();

  protected toPercent(value: number) {
    return Math.round(value * 100) + '%';
  }
}
