import {HttpClient} from '@angular/common/http';
import {Component, inject, input, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {
  AiChatMessage,
  AiChatRequest,
  AiChatResponse,
} from '../../../../../runner/shared-interfaces';
import {MessageSpinner} from '../message-spinner';

interface Model {
  id: string;
  name: string;
}

@Component({
  selector: 'app-ai-assistant',
  templateUrl: './ai-assistant.html',
  styleUrl: './ai-assistant.scss',
  imports: [FormsModule, MessageSpinner],
  host: {
    '[class.expanded]': 'isExpanded()',
  },
})
export class AiAssistant {
  readonly reportGroupId = input.required<string>();
  readonly close = output();

  protected messages: AiChatMessage[] = [];
  protected userInput = signal('');
  protected isLoading = signal(false);
  protected isExpanded = signal(false);

  private readonly http = inject(HttpClient);

  protected readonly models: Model[] = [
    {id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash'},
    {id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro'},
    {id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite'},
  ];
  protected selectedModel = this.models[0].id;

  protected toggleExpanded(): void {
    this.isExpanded.set(!this.isExpanded());
  }

  async send(): Promise<void> {
    if (!this.userInput().trim() || this.isLoading()) {
      return;
    }

    const pastMessages = this.messages.slice();

    this.messages.push({role: 'user', text: this.userInput()});
    const prompt = this.userInput();
    this.userInput.set('');
    this.isLoading.set(true);

    const payload: AiChatRequest = {
      prompt,
      pastMessages,
      model: this.selectedModel,
    };

    try {
      const result = await firstValueFrom(
        this.http.post<AiChatResponse>(`/api/reports/${this.reportGroupId()}/chat`, payload),
      );
      this.messages.push({role: 'model', text: result.responseHtml});
    } catch (e) {
      console.error('Failed to get AI response', e);
      this.messages.push({
        role: 'model',
        text: 'Sorry, I failed to get a response. Please try again.',
      });
    } finally {
      this.isLoading.set(false);
    }
  }
}
