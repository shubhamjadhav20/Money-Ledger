import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthStore } from '../api/auth';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';

@Component({
  selector: 'app-connect',
  imports: [UiButton, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connect.html',
  styleUrl: './connect.css',
})
export class Connect {
  private readonly auth = inject(AuthStore);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected async submit(token: string): Promise<void> {
    if (token.trim() === '') {
      this.problem.set('Paste your API token first.');
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    this.auth.connect(token);
    try {
      await this.api.checkToken();
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.auth.disconnect();
      this.problem.set(
        error instanceof ApiError && error.status === 401
          ? 'That token was not accepted.'
          : error instanceof ApiError
            ? error.message
            : 'Could not connect.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
