import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthStore, authInterceptor } from './auth';

describe('AuthStore', () => {
  it('starts signed out, trims the token it is given and forgets it on disconnect', () => {
    const auth = TestBed.inject(AuthStore);
    expect(auth.connected()).toBe(false);
    expect(auth.bearer()).toBeNull();

    auth.connect('  secret-token \n');
    expect(auth.connected()).toBe(true);
    expect(auth.bearer()).toBe('secret-token');

    auth.disconnect();
    expect(auth.connected()).toBe(false);
    expect(auth.bearer()).toBeNull();
  });

  it('keeps the token out of browser storage', () => {
    TestBed.inject(AuthStore).connect('secret-token');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('secret-token');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('secret-token');
  });
});

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
  });

  it('adds the bearer token to API calls', () => {
    TestBed.inject(AuthStore).connect('abc');
    http.get('/api/free').subscribe();
    expect(backend.expectOne('/api/free').request.headers.get('Authorization')).toBe('Bearer abc');
  });

  it('sends nothing when there is no token', () => {
    http.get('/api/free').subscribe();
    expect(backend.expectOne('/api/free').request.headers.has('Authorization')).toBe(false);
  });

  it('never attaches the token to anything that is not an API call', () => {
    TestBed.inject(AuthStore).connect('abc');
    http.get('https://example.com/api/free').subscribe();
    http.get('/assets/data.json').subscribe();
    http.get('/apix/free').subscribe();
    for (const url of ['https://example.com/api/free', '/assets/data.json', '/apix/free']) {
      expect(backend.expectOne(url).request.headers.has('Authorization')).toBe(false);
    }
  });
});
