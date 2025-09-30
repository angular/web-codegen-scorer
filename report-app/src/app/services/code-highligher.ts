import {Injectable, OnDestroy} from '@angular/core';
import {CodeToHastOptions, createHighlighterCoreSync, HighlighterCore} from 'shiki/core';
import {createOnigurumaEngine} from 'shiki/engine/oniguruma';
import angularTs from '@shikijs/langs/angular-ts';
import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';

@Injectable({providedIn: 'root'})
export class CodeHighligher implements OnDestroy {
  private cachedHighligher: HighlighterCore | undefined;

  async codeToHtml(code: string, options: CodeToHastOptions): Promise<string> {
    const highlighter = await this.getHighlighter();
    return highlighter.codeToHtml(code, options);
  }

  ngOnDestroy(): void {
    this.cachedHighligher?.dispose();
  }

  private async getHighlighter() {
    if (!this.cachedHighligher) {
      const engine = await createOnigurumaEngine(import('shiki/wasm'));
      this.cachedHighligher = createHighlighterCoreSync({
        themes: [githubLight, githubDark],
        langs: [angularTs],
        engine,
      });
    }

    return this.cachedHighligher;
  }
}
