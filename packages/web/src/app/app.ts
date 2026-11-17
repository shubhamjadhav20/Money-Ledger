import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from './api/auth';
import { UiButton } from './ui/button';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  constructor() {
    // A rejected token signs this tab out (see ApiClient); send the user to connect again.
    effect(() => {
      if (!this.auth.connected() && this.needsConnection(this.router.url)) {
        void this.router.navigateByUrl('/connect');
      }
    });
  }

  protected disconnect(): void {
    this.auth.disconnect();
    void this.router.navigateByUrl('/connect');
  }

  private needsConnection(url: string): boolean {
    return url.startsWith('/dashboard');
  }
}
