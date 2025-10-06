import {Component, ElementRef, inject, input, model, signal} from '@angular/core';

interface MultiSelectOption {
  label: string;
  value: unknown;
}

@Component({
  selector: 'multi-select',
  templateUrl: 'multi-select.html',
  styleUrl: 'multi-select.scss',
  host: {
    '(document:click)': 'outsideClick($event)',
  },
})
export class MultiSelect {
  private elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  options = input.required<MultiSelectOption[]>();
  label = input.required<string>();
  selected = model<unknown[]>([]);

  protected isOpen = signal(false);

  protected optionClicked(option: MultiSelectOption) {
    this.selected.update(selected => {
      if (selected.includes(option.value)) {
        return selected.filter(current => current !== option.value);
      }
      return [...selected, option.value];
    });
  }

  protected outsideClick(event: MouseEvent) {
    if (this.isOpen() && !this.elementRef.nativeElement.contains(event.target as HTMLElement)) {
      this.isOpen.set(false);
    }
  }
}
