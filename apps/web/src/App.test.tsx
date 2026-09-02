import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => vi.restoreAllMocks());

describe('foundation shell', () => {
  it('shows the application identity and healthy status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            (typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url
            ).endsWith('/me')
              ? {
                  user: { email: 'owner@example.test', roles: ['owner'] },
                  environment: 'local',
                  database: 'ready',
                }
              : { status: 'ok', service: 'api', environment: 'local', version: 'test' },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'VISION MAXSON' })).toBeInTheDocument();
    expect(await screen.findByText('Foundation online')).toBeInTheDocument();
    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
  });
});
