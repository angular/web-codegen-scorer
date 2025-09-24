import puppeteer, { Protocol } from 'puppeteer';
import fetch from 'node-fetch';
import { StrictCsp } from 'strict-csp';
import { CspViolation } from './auto-csp-types.js';

/**
 * Stores metadata about a script parsed by the browser's debugger.
 */
interface ScriptInfo {
  url: string;
  source: string;
  startLine: number; // 0-indexed
  endLine: number; // 0-indexed
}

/**
 * Encapsulates the logic for automatically applying a strict Content Security Policy
 * to a web page in Puppeteer and collecting violation reports.
 */
export class AutoCsp {
  public readonly violations: CspViolation[] = [];
  private readonly scriptInfosByUrl = new Map<string, ScriptInfo[]>();

  /**
   * Connects to the Chrome DevTools Protocol to instrument the page
   * and cache the source code of all loaded scripts.
   * @param page The Puppeteer page to connect to.
   */
  public async connectToDevTools(page: puppeteer.Page): Promise<void> {
    const client = await page.createCDPSession();
    await client.send('Debugger.enable');

    client.on(
      'Debugger.scriptParsed',
      async (event: Protocol.Debugger.ScriptParsedEvent) => {
        if (!event.url) {
          return;
        }
        try {
          const { scriptSource } = await client.send(
            'Debugger.getScriptSource',
            {
              scriptId: event.scriptId,
            }
          );

          const info: ScriptInfo = {
            url: event.url,
            source: scriptSource,
            startLine: event.startLine,
            endLine: event.endLine,
          };

          const existing = this.scriptInfosByUrl.get(event.url) ?? [];
          existing.push(info);
          this.scriptInfosByUrl.set(event.url, existing);
        } catch (e) {
          // This can happen for certain browser-internal scripts. We can ignore them.
        }
      }
    );
  }

  /**
   * Handles a Puppeteer HTTP request, applying CSP and intercepting reports.
   * @param request The Puppeteer HTTP request to handle.
   * @returns A promise that resolves to `true` if the request was handled (i.e., responded to or aborted),
   * or `false` if the request should be continued by the caller.
   */
  public async handleRequest(request: puppeteer.HTTPRequest): Promise<boolean> {
    // Intercept CSP violation reports
    if (request.url().endsWith('/csp-report') && request.method() === 'POST') {
      await this.handleCspReport(request);
      return true; // Request was handled
    }

    // Intercept navigation to HTML to inject the CSP header
    if (request.isNavigationRequest() && request.method() === 'GET') {
      await this.handleNavigation(request);
      return true; // Request was handled
    }

    return false; // Request was not handled by this module
  }

  /**
   * Iterates through the collected violations and adds the code snippets.
   * This should be called after the page has fully loaded to avoid race conditions.
   */
  public processViolations(): void {
    for (const report of this.violations) {
      this.addCodeSnippetToReport(report);
    }
  }

  private async handleCspReport(request: puppeteer.HTTPRequest): Promise<void> {
    try {
      const reportJson = JSON.parse(request.postData()!);
      const report = reportJson?.['csp-report'] as CspViolation | undefined;

      if (report) {
        // Just push the raw report. The snippet will be added later
        // in `processViolations` to avoid a race condition.
        this.violations.push(report);
      }
    } catch (e) {
      console.error('Could not parse CSP report:', e);
    }
    // Respond to the request so the browser doesn't hang
    await request.respond({ status: 204 });
  }

  private addCodeSnippetToReport(report: CspViolation): void {
    const sourceFileUrl = report['source-file'];
    // CSP line numbers are 1-indexed, but CDP is 0-indexed. Adjust it.
    const lineNumber = report['line-number'] ? report['line-number'] - 1 : -1;

    if (!sourceFileUrl || lineNumber < 0) {
      return;
    }

    const scriptInfos = this.scriptInfosByUrl.get(sourceFileUrl);
    if (!scriptInfos) {
      report.codeSnippet = `Could not find source code for URL: ${sourceFileUrl}`;
      return;
    }

    // Find the specific script block that contains the violation line.
    const script = scriptInfos.find(
      (s) => lineNumber >= s.startLine && lineNumber <= s.endLine
    );

    if (script) {
      const lines = script.source.split('\n');
      // Calculate the line number relative to the start of the script block.
      const relativeLine = lineNumber - script.startLine;
      const start = Math.max(0, relativeLine - 2);
      const end = Math.min(lines.length, relativeLine + 3);

      if (start >= end) {
        // If the range is invalid, just save the whole script.
        report.codeSnippet = script.source;
      } else {
        report.codeSnippet = lines.slice(start, end).join('\n');
      }
    } else {
      report.codeSnippet = `Could not find matching script block for line ${report['line-number']} in ${sourceFileUrl}`;
    }
  }

  private async handleNavigation(
    request: puppeteer.HTTPRequest
  ): Promise<void> {
    try {
      const response = await fetch(request.url(), {
        headers: request.headers(),
      });

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.startsWith('text/html')) {
        const originalHtml = await response.text();
        const autoCspHtmlBuilder = new StrictCsp(originalHtml);
        autoCspHtmlBuilder.refactorSourcedScriptsForHashBasedCsp();
        const scriptHashes = autoCspHtmlBuilder.hashAllInlineScripts();
        const strictCsp =
          StrictCsp.getStrictCsp(scriptHashes, {
            enableBrowserFallbacks: true,
            enableTrustedTypes: true,
          }) + '; report-uri /csp-report';

        const finalHtml = autoCspHtmlBuilder.serializeDom();

        await request.respond({
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            'Content-Security-Policy-Report-Only': strictCsp,
          },
          body: finalHtml,
        });
      } else {
        await request.respond({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.buffer(),
        });
      }
    } catch (e) {
      console.error(`Could not modify HTML response: ${e}`);
      await request.abort();
    }
  }
}
