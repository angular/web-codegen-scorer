import lighthouse from 'lighthouse';
import {Page} from 'puppeteer';
import {LighthouseAudit, LighthouseResult} from './worker-types.js';

export async function getLighthouseData(
  hostUrl: string,
  page: Page,
): Promise<LighthouseResult | undefined> {
  const data = await lighthouse(
    hostUrl,
    undefined,
    {
      extends: 'lighthouse:default',
      settings: {
        // Exclude accessibility since it's already covered by Axe above.
        onlyCategories: ['performance', 'best-practices'],
      },
    },
    page,
  );

  if (!data) {
    return undefined;
  }

  const availableAudits = new Map<string, LighthouseAudit>();
  const result: LighthouseResult = {categories: [], uncategorized: []};

  for (const audit of Object.values(data.lhr.audits)) {
    const type = audit.details?.type;
    const displayMode = audit.scoreDisplayMode;
    const isAllowedType =
      !type ||
      type === 'list' ||
      type === 'opportunity' ||
      (type === 'checklist' && Object.keys(audit.details?.items || {}).length > 0) ||
      (type === 'table' && audit.details?.items.length);
    const isAllowedDisplayMode = displayMode === 'binary' || displayMode === 'numeric';

    if (audit.score != null && isAllowedType && isAllowedDisplayMode) {
      availableAudits.set(audit.id, audit);
    }
  }

  for (const category of Object.values(data.lhr.categories)) {
    const auditsForCategory: LighthouseAudit[] = [];

    for (const ref of category.auditRefs) {
      const audit = availableAudits.get(ref.id);

      if (audit) {
        auditsForCategory.push(audit);
        availableAudits.delete(ref.id);
      }
    }

    result.categories.push({
      id: category.id,
      displayName: category.title,
      description: category.description || '',
      score: category.score || 0,
      audits: auditsForCategory,
    });
  }

  // Track all remaining audits as uncategorized.
  result.uncategorized.push(...availableAudits.values());

  return result.categories.length === 0 && result.uncategorized.length === 0 ? undefined : result;
}
