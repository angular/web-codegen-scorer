import {Component, computed, inject, signal} from '@angular/core';
import {MultiSelect} from '../multi-select/multi-select';
import {ReportsFetcher} from '../../services/reports-fetcher';

/** Renders out a toolbar that filters reports based on the user selection. */
@Component({
  selector: 'report-filters',
  templateUrl: 'report-filters.html',
  styleUrl: 'report-filters.scss',
  imports: [MultiSelect],
})
export class ReportFilters {
  private reportsFetcher = inject(ReportsFetcher);
  protected selectedFramework = signal<string | null>(null);
  protected selectedModel = signal<string | null>(null);
  protected selectedRunner = signal<string | null>(null);
  protected selectedLabels = signal<string[]>([]);

  protected allFrameworks = computed(() => {
    const frameworks = new Map<string, string>();
    this.reportsFetcher.reportGroups().forEach(group => {
      const framework = group.framework.fullStackFramework;
      frameworks.set(framework.id, framework.displayName);
    });
    return Array.from(frameworks.entries()).map(([id, displayName]) => ({
      id,
      displayName,
    }));
  });

  protected allModels = computed(() => {
    const models = new Set(this.reportsFetcher.reportGroups().map(g => g.model));

    return Array.from(models).map(model => ({
      id: model,
      displayName: model,
    }));
  });

  protected allRunners = computed(() => {
    const runners = new Map<string, string>();

    this.reportsFetcher.reportGroups().forEach(group => {
      if (group.runner) {
        runners.set(group.runner.id, group.runner.displayName);
      }
    });

    return Array.from(runners.entries()).map(([id, displayName]) => ({
      id,
      displayName,
    }));
  });

  protected allLabels = computed(() => {
    const labels = new Set<string>();

    for (const group of this.reportsFetcher.reportGroups()) {
      for (const label of group.labels) {
        const trimmed = label.trim();

        if (trimmed) {
          labels.add(trimmed);
        }
      }
    }

    return Array.from(labels)
      .sort()
      .map(label => ({
        label,
        value: label,
      }));
  });

  readonly filteredGroups = computed(() => {
    const framework = this.selectedFramework();
    const model = this.selectedModel();
    const runner = this.selectedRunner();
    const labels = this.selectedLabels();
    const groups = this.reportsFetcher.reportGroups();

    return groups.filter(group => {
      const frameworkMatch = !framework || group.framework.fullStackFramework.id === framework;
      const modelMatch = !model || group.model === model;
      const runnerMatch = !runner || group.runner?.id === runner;
      const labelsMatch = labels.length === 0 || group.labels.some(l => labels.includes(l.trim()));
      return frameworkMatch && modelMatch && runnerMatch && labelsMatch;
    });
  });
}
