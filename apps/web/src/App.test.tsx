import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => vi.restoreAllMocks());

describe('Phase 3 product shell', () => {
  it('shows authenticated product navigation and honest empty states', async () => {
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
              : (typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url
                  ).endsWith('/catalogs')
                ? { platforms: [], objectives: [], strategyDefaults: [] }
                : { items: [] },
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

    expect(await screen.findByRole('button', { name: 'Proyectos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Espacio de trabajo' })).toBeInTheDocument();
    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    expect(screen.getByText(/no se inventan ingresos ni analíticas/i)).toBeInTheDocument();
  });
});
