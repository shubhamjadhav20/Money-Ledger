import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App shell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('has a skip link, a labelled nav and a main landmark', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Main');
    expect(el.querySelector('main#main')).not.toBeNull();
  });

  it.each(['/', '/nowhere'])('%s lands on the gallery', async (url) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    expect(TestBed.inject(Router).url).toBe('/gallery');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      'Component gallery',
    );
  });
});
