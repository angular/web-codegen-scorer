import {Component, output, input} from '@angular/core';

@Component({
  selector: 'failed-checks-filter',
  template: `
    @for (check of allFailedChecks(); track check.name) {
      <label>
        <input
          type="checkbox"
          [checked]="selectedChecks().has(check.name)"
          (change)="toggleCheck.emit(check.name)"
        />
        {{ check.name }} ({{ check.count }})
      </label>
    }
  `,
  styles: `
    label {
      display: block;
      padding: 8px 12px;
      cursor: pointer;
    }

    label:hover {
      background-color: #eff6ff;
      border-radius: var(--border-radius);
    }
  `,
})
export class FailedChecksFilter {
  allFailedChecks = input.required<{name: string; count: number}[]>();
  selectedChecks = input.required<Set<string>>();
  toggleCheck = output<string>();
}
