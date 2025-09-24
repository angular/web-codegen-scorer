import { AxePuppeteer } from '@axe-core/puppeteer';
import { Result } from 'axe-core';
import puppeteer from 'puppeteer';
import { callWithTimeout } from '../../utils/timeout.js';
import { AutoCsp } from './auto-csp.js';
import { CspViolation } from './auto-csp-types.js';
import { ServeTestingProgressLogFn } from './worker-types.js';

/**
 * Uses Puppeteer to take a screenshot of the main page, perform Axe testing,
 * and returns the screenshot encoded as a base64 string. Also collects browser errors
 * and reports them back so that they can be included into reports.
 */
export async function runAppInPuppeteer(
  appName: string,
  hostUrl: string,
  takeScreenshots: boolean,
  includeAxeTesting: boolean,
  progressLog: ServeTestingProgressLogFn,
  enableAutoCsp: boolean
) {
  const runtimeErrors: string[] = [];

  // Undefined by default so it gets flagged correctly as `skipped` if there's no data.
  let cspViolations: CspViolation[] | undefined;
  let screenshotBase64Data: string | undefined;
  let axeViolations: Result[] | undefined;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const page = await browser.newPage();

    page.on('console', async (message) => {
      if (message.type() !== 'error') return;

      if (!message.text().includes('JSHandle@error')) {
        progressLog(
          'error',
          `${message.type().substring(0, 3).toUpperCase()} ${message.text()}`
        );
        return;
      }
      const messages = await Promise.all(
        message.args().map(async (arg) => {
          const [message, stack] = await Promise.all([
            arg.getProperty('message'),
            arg.getProperty('stack'),
          ]);

          let result = '';
          if (message) {
            result += message;
          }
          if (stack) {
            result += (result.length ? '\n\n' : '') + stack;
          }
          return result;
        })
      );
      runtimeErrors.push(messages.filter(Boolean).join('\n'));
    });

    page.on('pageerror', (error) => {
      progressLog('error', 'Page error', error.message);
      runtimeErrors.push(error.toString());
    });

    await page.setViewport({ width: 1280, height: 720 });

    // Set up auto-CSP handling if enabled for the environment.
    if (enableAutoCsp) {
      const autoCsp = new AutoCsp();
      await autoCsp.connectToDevTools(page);
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        if (request.isInterceptResolutionHandled()) {
          return;
        }

        // Delegate CSP-related requests to the AutoCsp class
        const handled = await autoCsp.handleRequest(request);
        if (!handled) {
          // Other requests (CSS, JS, images) pass through
          await request.continue();
        }
      });

      await page.goto(hostUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Now that the page is loaded, process the collected CSP reports.
      autoCsp.processViolations();
      cspViolations = autoCsp.violations;
    } else {
      // If CSP is not enabled, just navigate to the page directly.
      await page.goto(hostUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
    }

    // Perform Axe Testing
    if (includeAxeTesting) {
      try {
        progressLog('eval', `Running Axe accessibility test from ${hostUrl}`);
        const axeResults = await new AxePuppeteer(page).analyze();
        axeViolations = axeResults.violations;
        progressLog('success', `Axe accessibility test completed.`);

        if (axeViolations.length > 0) {
          progressLog('error', `Found ${axeViolations.length} Axe violations.`);
        } else {
          progressLog('success', `No Axe violations found.`);
        }
      } catch (axeError: any) {
        progressLog(
          'error',
          'Could not perform Axe accessibility test',
          axeError.message
        );
      }
    }

    if (takeScreenshots) {
      progressLog('eval', `Taking screenshot from ${hostUrl}`);

      screenshotBase64Data = await callWithTimeout(
        `Taking screenshot for ${appName}`,
        () =>
          page.screenshot({
            type: 'png',
            fullPage: true,
            encoding: 'base64',
          }),
        1 // 1 minute
      );
      progressLog('success', 'Screenshot captured and encoded');
    }
    await browser.close();
  } catch (screenshotError: any) {
    let details: string = screenshotError.message;

    if (screenshotError.stack) {
      details += '\n' + screenshotError.stack;
    }

    progressLog('error', 'Could not take screenshot', details);
  }

  return { screenshotBase64Data, runtimeErrors, axeViolations, cspViolations };
}
