import {Component, input} from '@angular/core';
import {Spinner} from './spinner/spinner';

@Component({
  selector: 'message-spinner',
  template: `
    <spinner />
    {{ message() }}
  `,
  imports: [Spinner],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 25px;
      align-items: center;
      width: 100%;
      margin: 50px auto;
    }

    spinner {
      width: 80px;
      padding: 8px;
    }
  `,
})
export class MessageSpinner {
  readonly message = input.required<string>();
}
