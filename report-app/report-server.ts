import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatWithReportAI} from '../runner/reporting/report-ai-chat';
import {convertV2ReportToV3Report} from '../runner/reporting/migrations/v2_to_v3';
import {FetchedLocalReports, fetchReportsFromDisk} from '../runner/reporting/report-local-disk';
import {AiChatRequest, AIConfigState, RunInfo} from '../runner/shared-interfaces';

// This will result in a lot of loading and would slow down the serving,
// so it's loaded lazily below.
import {type GenkitRunner} from '../runner/codegen/genkit/genkit-runner';

const app = express();
const reportsLoader = await getReportLoader();
const options = getOptions();
const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const angularApp = new AngularNodeAppEngine();
let localDataPromise: Promise<FetchedLocalReports> | null = null;

app.use(express.json());

// Endpoint for fetching all available report groups.
app.get('/api/reports', async (_, res) => {
  const [remoteGroups, localData] = await Promise.all([
    reportsLoader.getGroupsList(),
    resolveLocalData(options.reportsRoot),
  ]);
  const results = remoteGroups.slice();

  for (const [, data] of localData) {
    results.unshift(data.group);
  }

  res.json(results);
});

async function fetchAndMigrateReports(id: string): Promise<RunInfo[] | null> {
  const localData = await resolveLocalData(options.reportsRoot);
  let result: RunInfo[] | null = null;

  if (localData.has(id)) {
    result = [localData.get(id)!.run];
  } else {
    result = await reportsLoader.getGroupedReports(id);
  }

  if (result === null) {
    return null;
  }

  // Convert potential older v2 reports.
  return result.map(r => convertV2ReportToV3Report(r));
}

// Endpoint for fetching a specific report group.
app.get('/api/reports/:id', async (req, res) => {
  const id = req.params.id;
  const result = await fetchAndMigrateReports(id);

  res.json(result ?? []);
});

let llm: Promise<GenkitRunner> | null = null;

/** Lazily initializes and returns the genkit runner. */
async function getOrCreateGenkitLlmRunner() {
  const llm = new (await import('../runner/codegen/genkit/genkit-runner')).GenkitRunner();
  // Gracefully shut down the runner on exit.
  process.on('SIGINT', () => llm!.dispose());
  process.on('SIGTERM', () => llm!.dispose());
  return llm;
}

// Endpoint for fetching a specific report group.
app.post('/api/reports/:id/chat', async (req, res) => {
  const id = req.params.id;
  const reports = await fetchAndMigrateReports(id);

  if (reports === null) {
    res.status(404).send('Not found');
    return;
  }

  try {
    const {prompt, pastMessages, model} = req.body as AiChatRequest;
    const assessments = reports.flatMap(run => run.results);
    const abortController = new AbortController();
    const summary = await chatWithReportAI(
      await (llm ?? getOrCreateGenkitLlmRunner()),
      prompt,
      abortController.signal,
      assessments,
      pastMessages,
      model,
    );
    res.json(summary);
  } catch (e) {
    console.error(e);
    if (e instanceof Error) {
      console.error(e.stack);
    }
    res.status(500);
    res.end(`Unexpected error. See terminal logs.`);
  }
});

app.get('/api/ai-config-state', async (req, res) => {
  try {
    const llm = await getOrCreateGenkitLlmRunner();
    return res.json({
      configuredModels: llm.getSupportedModelsWithAPIKey(),
    } satisfies AIConfigState);
  } catch (e) {
    console.error('Could not instantiate LLM instance. Error:', e);
    if (e instanceof Error) {
      console.error(e.stack);
    }
    return res.json({configuredModels: []});
  }
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then(response => {
      return response ? writeResponseToNodeResponse(response, res) : next();
    })
    .catch(next);
});

// Support custom endpoints by advanced users.
await reportsLoader.configureEndpoints?.(app);

if (isMainModule(import.meta.url)) {
  app.listen(options.port, () => {
    console.log(`Server listening on port: ${options.port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);

interface ReportLoader {
  getGroupedReports: (groupId: string) => Promise<RunInfo[]>;
  getGroupsList: () => Promise<{id: string}[]>;
  configureEndpoints?: (expressApp: typeof app) => Promise<void>;
}

/** Gets the server options from the command line. */
function getOptions() {
  const defaultPort = 4200;
  const envPort = process.env['CODEGEN_REPORTS_PORT'];
  const reportsRoot = process.env['CODEGEN_REPORTS_DIR'] || './.web-codegen-scorer/reports';

  return {
    port: envPort ? parseInt(envPort) || defaultPort : defaultPort,
    reportsRoot: isAbsolute(reportsRoot) ? reportsRoot : join(process.cwd(), reportsRoot),
  };
}

async function getReportLoader() {
  const reportLoaderPath = process.env['CODEGEN_REPORTS_LOADER'];

  // If no loader is configured, return an empty response.
  if (!reportLoaderPath) {
    return {
      getGroupedReports: () => Promise.resolve([]),
      getGroupsList: () => Promise.resolve([]),
      configureEndpoints: async () => {},
    } satisfies ReportLoader;
  }

  const loaderImportPath = isAbsolute(reportLoaderPath)
    ? reportLoaderPath
    : join(process.cwd(), reportLoaderPath);
  const importResult: {default: ReportLoader} = await import(/* @vite-ignore */ loaderImportPath);

  if (
    !importResult.default ||
    typeof importResult.default.getGroupedReports !== 'function' ||
    typeof importResult.default.getGroupsList !== 'function'
  ) {
    throw new Error(
      'Invalid remote import loader. The file must have a default export ' +
        'with `getGroupedReports` and `getGroupsList` functions.',
    );
  }

  return importResult.default;
}

async function resolveLocalData(directory: string) {
  // Reuse the same promise so that concurrent requests get the same response.
  if (!localDataPromise) {
    let resolveFn: (data: FetchedLocalReports) => void;
    localDataPromise = new Promise(resolve => (resolveFn = resolve));
    resolveFn!(await fetchReportsFromDisk(directory));
  }

  return localDataPromise;
}
