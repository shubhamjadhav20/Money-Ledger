import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ImportIssueView, TransactionView } from '../api/models';
import { formatDay, plural } from '../format';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { METHOD_LABELS } from '../transactions/labels';
import { ImportStore } from './import-store';

/** Issues are shown in full up to this many; the rest are counted. */
const ISSUES_SHOWN = 8;

@Component({
  selector: 'app-import',
  imports: [RouterLink, UiButton, UiCard, UiMoney, UiStateMessage],
  providers: [ImportStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-screen.html',
  styleUrl: './import-screen.css',
})
export class ImportScreen {
  protected readonly store = inject(ImportStore);

  protected readonly formatDay = formatDay;
  protected readonly plural = plural;
  protected readonly methodLabels = METHOD_LABELS;

  constructor() {
    void this.store.loadAccounts();
  }

  protected reloadAccounts(): void {
    void this.store.loadAccounts();
  }

  protected onAccount(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.store.setAccount(event.target.value);
  }

  protected onLayout(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.store.setLayout(event.target.value);
  }

  protected async onFile(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    const file = event.target.files?.item(0);
    if (file === null || file === undefined) return;
    try {
      this.store.setFile(file.name, await file.text());
    } catch {
      this.store.failFile('Could not read that file.');
    }
  }

  protected preview(): void {
    void this.store.preview();
  }

  protected choose(rowKey: string, value: string): void {
    void this.store.choose(rowKey, value);
  }

  protected confirm(): void {
    void this.store.confirm();
  }

  protected issueLine(issue: ImportIssueView): string {
    return issue.line === 0 ? 'The file' : `Line ${String(issue.line)}`;
  }

  protected issues(all: readonly ImportIssueView[]): readonly ImportIssueView[] {
    return all.slice(0, ISSUES_SHOWN);
  }

  protected moreIssues(all: readonly ImportIssueView[]): number {
    return Math.max(0, all.length - ISSUES_SHOWN);
  }

  /** What to call one of your own entries: its note, else who it was to, else its category. */
  protected entryLabel(entry: TransactionView): string {
    return (
      [entry.memo, entry.counterparty, entry.category].find((v) => v !== null && v !== '') ??
      'Entry you added'
    );
  }
}
