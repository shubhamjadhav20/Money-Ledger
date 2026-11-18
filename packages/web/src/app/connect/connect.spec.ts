import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthStore } from '../api/auth';
import { query } from '../../testing';
import { fakeApi } from '../../testing-api';
import { Connect } from './connect';

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [{ provide: ApiClient, useValue: api }, provideRouter([])],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(Connect);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const submit = async (token: string): Promise<void> => {
    (query(root, '#token') as HTMLInputElement).value = token;
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { api, auth: TestBed.inject(AuthStore), navigate, root, submit };
}

describe('Connect', () => {
  it('asks for the token in a masked, unsuggested field', async () => {
    const { root } = await render();
    const input = query(root, '#token') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(query(root, 'label').getAttribute('for')).toBe('token');
    expect(root.textContent).toContain("kept in this tab's memory only");
  });

  it('connects with a good token and goes to the dashboard', async () => {
    const { api, auth, navigate, root, submit } = await render();
    await submit('  good-token ');
    expect(api.checkToken).toHaveBeenCalledTimes(1);
    expect(auth.bearer()).toBe('good-token');
    expect(navigate).toHaveBeenCalledWith('/dashboard');
    expect(root.querySelector('[role=alert]')).toBeNull();
  });

  it('refuses an empty token without calling the server', async () => {
    const { api, auth, navigate, root, submit } = await render();
    await submit('   ');
    expect(api.checkToken).not.toHaveBeenCalled();
    expect(auth.connected()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(query(root, '[role=alert]').textContent).toContain('Paste your API token first.');
    expect(query(root, '#token').getAttribute('aria-invalid')).toBe('true');
  });

  it('says the token was not accepted, and forgets it', async () => {
    const { auth, navigate, root, submit } = await render({
      checkToken: () => Promise.reject(new ApiError(401, 'unauthorized', 'Bad token')),
    });
    await submit('wrong');
    expect(query(root, '[role=alert]').textContent).toContain('That token was not accepted.');
    expect(auth.connected()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the reason when the server cannot be reached', async () => {
    const { auth, root, submit } = await render({
      checkToken: () =>
        Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')),
    });
    await submit('token');
    expect(query(root, '[role=alert]').textContent).toContain('Could not reach the server');
    expect(auth.connected()).toBe(false);
  });

  it('a token that may not read is a capture-only token: it opens quick-add and nothing else', async () => {
    const { auth, navigate, root, submit } = await render({
      checkToken: () =>
        Promise.reject(new ApiError(403, 'forbidden', 'This token cannot use this endpoint')),
    });
    await submit('capture-token');
    expect(auth.bearer()).toBe('capture-token');
    expect(auth.captureOnly()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/quick-add');
    expect(root.querySelector('[role=alert]')).toBeNull();
  });

  it('a token that can read is not capture-only', async () => {
    const { auth, submit } = await render();
    await submit('full-token');
    expect(auth.captureOnly()).toBe(false);
  });

  it('never prints the token on screen', async () => {
    const { root, submit } = await render({
      checkToken: () => Promise.reject(new ApiError(401, 'unauthorized', 'Bad token')),
    });
    await submit('super-secret-value');
    expect(root.innerHTML).not.toContain('super-secret-value');
  });
});
