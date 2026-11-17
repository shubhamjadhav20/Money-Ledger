import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DateError, MoneyError, parseAmount, parseLocalDate } from '@ledger/core';
import type { LocalDate, Paise } from '@ledger/core';
import type { PotChange, PotInput } from '../api/api-client';
import type { AccountBalanceView, PotView } from '../api/models';
import { POT_KINDS } from '../api/models';
import { plainAmount } from '../format';
import { UiButton } from '../ui/button';
import { POT_KIND_HELP, POT_KIND_LABELS } from './labels';

type Kind = PotView['kind'];
type Problems = Readonly<Partial<Record<'name' | 'target' | 'due', string>>>;

/**
 * Makes a pot, or changes one. When `pot` is given it edits: the kind and the card it covers are
 * fixed for the pot's life, and only what actually changed is sent. Amounts are read as exact
 * rupees and paise; an empty target or due date means "none".
 */
@Component({
  selector: 'app-pot-form',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pot-form.html',
  styleUrl: './pot-form.css',
})
export class PotForm {
  /** The pot being edited; null makes a new one. */
  readonly pot = input<PotView | null>(null);
  /** Card accounts a new bill pot can be set aside for. */
  readonly cards = input<readonly AccountBalanceView[]>([]);
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly create = output<PotInput>();
  readonly edit = output<PotChange>();
  readonly cancel = output();

  protected readonly kinds = POT_KINDS;
  protected readonly kindLabels = POT_KIND_LABELS;

  private readonly typedName = signal<string | null>(null);
  private readonly pickedKind = signal<Kind>('buffer');
  private readonly typedTarget = signal<string | null>(null);
  private readonly typedDue = signal<string | null>(null);
  protected readonly coversId = signal('');
  protected readonly problems = signal<Problems>({});

  protected readonly name = computed(() => this.typedName() ?? this.pot()?.name ?? '');
  protected readonly kind = computed<Kind>(() => this.pot()?.kind ?? this.pickedKind());
  protected readonly target = computed(() => {
    const typed = this.typedTarget();
    if (typed !== null) return typed;
    const current = this.pot()?.targetPaise ?? null;
    return current === null ? '' : plainAmount(current);
  });
  protected readonly due = computed(() => this.typedDue() ?? this.pot()?.dueDate ?? '');
  protected readonly kindHelp = computed(() => POT_KIND_HELP[this.kind()]);
  /** An existing pot keeps its card; a new bill pot may pick one. */
  protected readonly canPickCard = computed(
    () => this.pot() === null && this.kind() === 'bill' && this.cards().length > 0,
  );
  protected readonly id = computed(() => `pf-${this.pot()?.id ?? 'new'}`);

  protected onName(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typedName.set(event.target.value);
  }

  protected onTarget(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typedTarget.set(event.target.value);
  }

  protected onDue(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typedDue.set(event.target.value);
  }

  protected onKind(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = POT_KINDS.find((k) => k === value);
    if (picked !== undefined) this.pickedKind.set(picked);
  }

  protected onCovers(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.coversId.set(event.target.value);
  }

  private readTarget(problems: { target?: string }): Paise | null | undefined {
    const raw = this.target().trim();
    if (raw === '') return null;
    try {
      const amount = parseAmount(raw);
      if (amount < 0) {
        problems.target = 'A target cannot be negative.';
        return undefined;
      }
      return amount;
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      problems.target = 'Use a plain amount like 12,345.50.';
      return undefined;
    }
  }

  private readDue(problems: { due?: string }): LocalDate | null | undefined {
    const raw = this.due().trim();
    if (raw === '' || this.kind() !== 'bill') return null;
    try {
      return parseLocalDate(raw, 'yyyy-mm-dd');
    } catch (error) {
      if (!(error instanceof DateError)) throw error;
      problems.due = 'Pick a real date.';
      return undefined;
    }
  }

  protected submit(): void {
    const problems: { name?: string; target?: string; due?: string } = {};
    const name = this.name().trim();
    if (name === '') problems.name = 'Give the pot a name.';
    else if (name.length > 60) problems.name = 'Keep the name to 60 characters.';
    const target = this.readTarget(problems);
    const due = this.readDue(problems);
    this.problems.set(problems);
    if (Object.keys(problems).length > 0 || target === undefined || due === undefined) return;

    const existing = this.pot();
    if (existing === null) {
      const covers = this.canPickCard() ? this.coversId() : '';
      this.create.emit({
        name,
        kind: this.kind(),
        ...(target === null ? {} : { targetPaise: target }),
        ...(due === null ? {} : { dueDate: due }),
        ...(covers === '' ? {} : { coversCardAccountId: covers }),
      });
      return;
    }
    const change: { name?: string; targetPaise?: Paise | null; dueDate?: LocalDate | null } = {};
    if (name !== existing.name) change.name = name;
    if (target !== existing.targetPaise) change.targetPaise = target;
    if (existing.kind === 'bill' && due !== existing.dueDate) change.dueDate = due;
    if (Object.keys(change).length === 0) this.cancel.emit();
    else this.edit.emit(change);
  }
}
