import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  status: 'ok';
  service: string;
  environment: string;
  version: string;
}

interface SessionResponse {
  user: { email: string; roles: string[] };
  environment: string;
  database: 'ready';
}

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Health check failed');
  return response.json() as Promise<HealthResponse>;
}

async function loadSession(): Promise<SessionResponse> {
  const response = await fetch('/api/v1/me', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Session check failed');
  return response.json() as Promise<SessionResponse>;
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: loadHealth });
  const session = useQuery({ queryKey: ['session'], queryFn: loadSession });
  const systemStatus = health.isSuccess
    ? 'Foundation online'
    : health.isError
      ? 'Unavailable'
      : 'Checking';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div className="eyebrow">PHASE 1 · DATA &amp; SECURITY CORE</div>
        <h1 id="page-title">VISION MAXSON</h1>
        <p className="product-name">AI Content Studio</p>
        <p className="summary">
          Identity, persistence, authorization and audit readiness for the private staging
          workspace. Product modules remain intentionally unavailable until their approved phases.
        </p>
        <div className="status" role="status" aria-live="polite">
          <span className={health.isError ? 'dot dot-error' : 'dot'} aria-hidden="true" />
          <div>
            <span className="status-label">System status</span>
            <strong>{systemStatus}</strong>
          </div>
        </div>
        <dl className="readiness" aria-label="Phase 1 readiness">
          <div>
            <dt>Environment</dt>
            <dd>{session.data?.environment ?? 'Checking'}</dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd>{session.data?.user.email ?? 'Checking'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{session.data?.user.roles.join(', ') ?? 'Checking'}</dd>
          </div>
          <div>
            <dt>D1</dt>
            <dd>{session.data?.database ?? 'Checking'}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
