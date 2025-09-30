import {Component, ViewEncapsulation} from '@angular/core';

@Component({
  selector: 'expansion-panel-header',
  template: `<ng-content />`,
  encapsulation: ViewEncapsulation.None,
  styles: `
    expansion-panel-header {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    expansion-panel-header svg,
    expansion-panel-header img,
    expansion-panel-header .material-symbols-outlined {
      width: 24px;
      height: 24px;
      font-size: 24px;
    }
  `,
})
export class ExpansionPanelHeader {}
