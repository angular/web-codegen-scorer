/**
 * Migrates a v2 report to a v3 report.
 * See: https://github.com/angular/web-codegen-scorer/commit/41ada541481a10c99de055ab6bb1c19b06a25b88.
 */
export function convertV2ReportToV3Report(doc: any) {
  if (doc.version === 3) {
    return doc;
  }

  const migrateFromBuildResultToSplit = (origBuildResult: any) => {
    const buildResult = {
      status: origBuildResult.status,
      message: origBuildResult.message,
      errorType: origBuildResult.errorType,
      safetyWebReportJson: origBuildResult.safetyWebReportJson,
      missingDependency: origBuildResult.missingDependency,
    };
    const serveTestingResult = {
      errorMessage: undefined,
      screenshotPngUrl: origBuildResult.screenshotPngUrl,
      runtimeErrors: origBuildResult.runtimeErrors,
      userJourneyAgentOutput: origBuildResult.userJourneyAgentOutput,
      cspViolations: origBuildResult.cspViolations,
      axeViolations: origBuildResult.axeViolations,
    };

    return { buildResult, serveTestingResult };
  };

  for (const result of doc.results) {
    const finalAttemptSplit = migrateFromBuildResultToSplit(result.build);
    result.finalAttempt = {
      buildResult: finalAttemptSplit.buildResult,
      serveTestingResult: finalAttemptSplit.serveTestingResult,
    };
    delete result.build;

    for (const attempt of result.attemptDetails) {
      const attemptSplit = migrateFromBuildResultToSplit(attempt.buildResult);
      attempt.buildResult = attemptSplit.buildResult;
      attempt.serveTestingResult = attemptSplit.serveTestingResult;
    }
  }

  doc.version = 3;

  return doc;
}
