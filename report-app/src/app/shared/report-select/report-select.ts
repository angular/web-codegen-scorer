import {Component, computed, input, model} from '@angular/core';
import {RunGroup} from '../../../../../runner/shared-interfaces';
import {DatePipe} from '@angular/common';

@Component({
  selector: 'report-select',
  templateUrl: './report-select.html',
  styleUrls: ['./report-select.scss'],
  imports: [DatePipe],
})
export class ReportSelect {
  reports = input<RunGroup[]>([]);
  selection = model<string | null>();

  readonly selectOptions = computed(() => {
    const grouped = this.reports().reduce(
      (acc, group) => {
        const dateGroup = new Date(group.timestamp).toDateString();
        if (!acc[dateGroup]) {
          acc[dateGroup] = [];
        }
        acc[dateGroup].push(group);
        return acc;
      },
      {} as {[key: string]: RunGroup[]},
    );

    const sortedDateGroups = Object.keys(grouped).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    return sortedDateGroups.map(dateGroup => {
      const options = grouped[dateGroup];
      options.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });
      return {
        dateGroup,
        options: options,
      };
    });
  });

  readonly selectedReport = computed(() => {
    return this.reports().find(r => r.id === this.selection());
  });

  onSelect(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    this.selection.set(selectElement.value);
  }
}
