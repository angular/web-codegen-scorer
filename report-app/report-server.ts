import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FetchedLocalReports,
  fetchReportsFromDisk,
} from '../runner/reporting/report-local-disk';
import { RunInfo } from '../runner/shared-interfaces';
import { convertV2ReportToV3Report } from '../runner/reporting/migrations/v2_to_v3';

const app = express();
const reportsLoader = await getReportLoader();
const options = getOptions();
const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const angularApp = new AngularNodeAppEngine();
let localDataPromise: Promise<FetchedLocalReports> | null = null;

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

// Endpoint for fetching a specific report group.
app.get('/api/reports/:id', async (req, res) => {
  const id = req.params.id;
  const localData = await resolveLocalData(options.reportsRoot);
  let result: RunInfo[] | null = null;

  if (localData.has(id)) {
    result = [localData.get(id)!.run];
  } else {
    result = await reportsLoader.getGroupedReports(id);
  }

  // Convert potential older v2 reports.
  result = result.map((r) => convertV2ReportToV3Report(r));

  res.json(result);
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
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
  getGroupsList: () => Promise<{ id: string }[]>;
  configureEndpoints?: (expressApp: typeof app) => Promise<void>;
}

/** Gets the server options from the command line. */
function getOptions() {
  const defaultPort = 4200;
  const envPort = process.env['CODEGEN_REPORTS_PORT'];
  const reportsRoot =
    process.env['CODEGEN_REPORTS_DIR'] || './.web-codegen-scorer/reports';

  return {
    port: envPort ? parseInt(envPort) || defaultPort : defaultPort,
    reportsRoot: isAbsolute(reportsRoot)
      ? reportsRoot
      : join(process.cwd(), reportsRoot),
  };
}

async function getReportLoader() {
  const reportLoaderPath = process.env['CODEGEN_REPORTS_LOADER'];

  // If no loader is configured, return an empty response.
  if (!reportLoaderPath) {
    return {
      getGroupedReports: () => Promise.resolve([]),
      getGroupsList: () => Promise.resolve([]),
    } satisfies ReportLoader;
  }

  const loaderImportPath = isAbsolute(reportLoaderPath)
    ? reportLoaderPath
    : join(process.cwd(), reportLoaderPath);
  const importResult: { default: ReportLoader } = await import(
    /* @vite-ignore */ loaderImportPath
  );

  if (
    !importResult.default ||
    typeof importResult.default.getGroupedReports !== 'function' ||
    typeof importResult.default.getGroupsList !== 'function'
  ) {
    throw new Error(
      'Invalid remote import loader. The file must have a default export ' +
        'with `getGroupedReports` and `getGroupsList` functions.'
    );
  }

  return importResult.default;
}

async function resolveLocalData(directory: string) {
  // Reuse the same promise so that concurrent requests get the same response.
  if (!localDataPromise) {
    let resolveFn: (data: FetchedLocalReports) => void;
    localDataPromise = new Promise((resolve) => (resolveFn = resolve));
    resolveFn!(await fetchReportsFromDisk(directory));
  }

  return localDataPromise;
}
