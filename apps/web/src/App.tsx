import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  status: 'ok';
  service: string;
  environment: string;
  version: string;
}

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Health check failed');
  return response.json() as Promise<HealthResponse>;
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: loadHealth });
  const systemStatus = health.isSuccess
    ? 'Foundation online'
    : health.isError
      ? 'Unavailable'
      : 'Checking';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div className="eyebrow">PHASE 0 · CLOUDFLARE FOUNDATION</div>
        <h1 id="page-title">VISION MAXSON</h1>
        <p className="product-name">AI Content Studio</p>
        <p className="summary">
          The private production workspace is being established. Product modules remain
          intentionally unavailable until their approved implementation phases.
        </p>
        <div className="status" role="status" aria-live="polite">
          <span className={health.isError ? 'dot dot-error' : 'dot'} aria-hidden="true" />
          <div>
            <span className="status-label">System status</span>
            <strong>{systemStatus}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
