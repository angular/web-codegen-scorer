import {
  afterRenderEffect,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import {SafeHtml} from '@angular/platform-browser';
import {CodeHighligher} from '../services/code-highligher';
import {AppColorMode} from '../services/app-color-mode';

@Component({
  selector: 'app-code-viewer',
  template: ``,
  styles: `
    pre {
      overflow: auto;
    }

    code {
      counter-reset: step;
      counter-increment: step 0;
    }

    code span.line {
      display: inline !important;
    }

    code .line::before {
      content: counter(step);
      counter-increment: step;
      width: 1rem;
      margin-right: 1.5rem;
      display: inline-block;
      text-align: right;
      color: rgba(115, 138, 148, 0.4);
    }
  `,
  encapsulation: ViewEncapsulation.None,
})
export class CodeViewer {
  private highlighter = inject(CodeHighligher);
  private colorService = inject(AppColorMode);
  protected formatedCode = signal<SafeHtml>('');

  code = input.required<string>();

  constructor() {
    const elementRef = inject(ElementRef);

    afterRenderEffect(async () => {
      const colorMode = this.colorService.colorMode();
      const highlightedString = await this.highlighter.codeToHtml(this.code(), {
        lang: 'angular-ts',
        theme: colorMode === 'dark' ? 'github-dark' : 'github-light',
      });
      elementRef.nativeElement.innerHTML = highlightedString;
    });
  }
}
