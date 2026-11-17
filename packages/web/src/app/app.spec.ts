import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ApiClient } from './api/api-client';
import { AuthStore } from './api/auth';
import { App } from './app';
import { routes } from './app.routes';
import { query } from '../testing';
import { fakeApi } from '../testing-api';

function setup(): { auth: AuthStore; router: Router } {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), { provide: ApiClient, useValue: fakeApi() }],
  });
  return { auth: TestBed.inject(AuthStore), router: TestBed.inject(Router) };
}

describe('App shell', () => {
  it('has a skip link, a labelled nav and a main landmark', async () => {
    setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Main');
    expect(el.querySelector('main#main')).not.toBeNull();
  });

  it('offers only the gallery until a token is connected', async () => {
    setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const nav = query(fixture.nativeElement as HTMLElement, 'nav');
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent.trim())).toEqual(['Gallery']);
    expect(nav.querySelector('button')).toBeNull();
  });

  it('shows the dashboard link and a Disconnect button once connected', async () => {
    const { auth } = setup();
    auth.connect('tok');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const nav = query(fixture.nativeElement as HTMLElement, 'nav');
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent.trim())).toEqual([
      'Dashboard',
      'Gallery',
    ]);
    expect(query(nav, 'button').textContent.trim()).toBe('Disconnect');
  });

  it('disconnect forgets the token and goes to the connect screen', async () => {
    const { auth, router } = setup();
    auth.connect('tok');
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    query(fixture.nativeElement as HTMLElement, 'nav button').click();
    await fixture.whenStable();
    expect(auth.connected()).toBe(false);
    expect(router.url).toBe('/connect');
  });

  it('sends the user to connect when a rejected token signs the tab out', async () => {
    const { auth, router } = setup();
    auth.connect('tok');
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    expect(router.url).toBe('/dashboard');

    auth.disconnect();
    await fixture.whenStable();
    expect(router.url).toBe('/connect');
  });

  it('leaves the gallery alone when signed out', async () => {
    const { auth, router } = setup();
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl('/gallery');
    auth.connect('tok');
    auth.disconnect();
    await fixture.whenStable();
    expect(router.url).toBe('/gallery');
  });
});

describe('Routing', () => {
  it.each(['/', '/dashboard', '/nowhere'])(
    '%s asks a signed-out visitor to connect',
    async (url) => {
      const { router } = setup();
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      expect(router.url).toBe('/connect');
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Connect');
    },
  );

  it.each(['/', '/connect', '/nowhere'])(
    '%s lands a connected visitor on the dashboard',
    async (url) => {
      const { auth, router } = setup();
      auth.connect('tok');
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      expect(router.url).toBe('/dashboard');
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Dashboard');
    },
  );

  it('serves the component gallery without a token', async () => {
    const { router } = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gallery');
    expect(router.url).toBe('/gallery');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      'Component gallery',
    );
  });
});
