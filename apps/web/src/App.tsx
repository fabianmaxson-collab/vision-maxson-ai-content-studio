import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
type Catalogs = {
  platforms: Array<{ id: string; key: string; displayName: string }>;
  objectives: Array<{ id: string; displayName: string }>;
  strategyDefaults: Array<{
    id: string;
    platform: string;
    contentFormat: string;
    priority: number;
    preferredMinSeconds: number | null;
    preferredMaxSeconds: number | null;
    rationale: string;
  }>;
};
type Brand = { id: string; name: string; niche: string; primaryLanguage: string; status: string };
type Channel = {
  id: string;
  contentBrandId: string;
  name: string;
  primaryLanguage: string;
  readinessStatus: string;
};
type Project = {
  id: string;
  title: string;
  format: string;
  operatingMode: string;
  status: string;
  brandName: string;
  channelName: string;
};
type Account = {
  id: string;
  displayName: string;
  platform: string;
  channelName: string;
  connectionStatus: string;
};
type Profile = {
  id: string;
  name: string;
  primaryLanguage?: string;
  description?: string;
  status: string;
};
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => ({ detail: 'Request failed' }))) as { detail?: string };
    throw new Error(b.detail ?? 'Request failed');
  }
  return r.json() as Promise<T>;
};
const formText = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
};
export function App() {
  const qc = useQueryClient(),
    [view, setView] = useState<
      'overview' | 'brands' | 'profiles' | 'projects' | 'accounts' | 'strategy'
    >('overview');
  const me = useQuery({
      queryKey: ['me'],
      queryFn: () =>
        api<{ user: { email: string; roles: string[] }; environment: string; database: string }>(
          '/me',
        ),
    }),
    catalogs = useQuery({ queryKey: ['catalogs'], queryFn: () => api<Catalogs>('/catalogs') }),
    brands = useQuery({
      queryKey: ['brands'],
      queryFn: () => api<{ items: Brand[] }>('/content-brands'),
    }),
    channels = useQuery({
      queryKey: ['channels'],
      queryFn: () => api<{ items: Channel[] }>('/channel-profiles'),
    }),
    projects = useQuery({
      queryKey: ['projects'],
      queryFn: () => api<{ items: Project[] }>('/projects'),
    }),
    accounts = useQuery({
      queryKey: ['accounts'],
      queryFn: () => api<{ items: Account[] }>('/social-accounts'),
    }),
    voices = useQuery({
      queryKey: ['voices'],
      queryFn: () => api<{ items: Profile[] }>('/voice-profiles'),
    }),
    characters = useQuery({
      queryKey: ['characters'],
      queryFn: () => api<{ items: Profile[] }>('/character-profiles'),
    });
  const createBrand = useMutation({
      mutationFn: (body: unknown) =>
        api('/content-brands', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
    }),
    createChannel = useMutation({
      mutationFn: ({ brandId, body }: { brandId: string; body: unknown }) =>
        api(`/content-brands/${brandId}/channel-profiles`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
    }),
    createProject = useMutation({
      mutationFn: (body: unknown) =>
        api('/projects', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    }),
    createAccount = useMutation({
      mutationFn: (body: unknown) =>
        api('/social-accounts', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
    }),
    createVoice = useMutation({
      mutationFn: (body: unknown) =>
        api('/voice-profiles', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['voices'] }),
    }),
    createCharacter = useMutation({
      mutationFn: (body: unknown) =>
        api('/character-profiles', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['characters'] }),
    });
  const brandSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    createBrand.mutate({
      name: d.get('name'),
      description: '',
      niche: d.get('niche'),
      primaryLanguage: d.get('language'),
      targetAudience: {},
      visualStyle: {},
      defaultVoiceProfileId: null,
    });
  };
  const channelSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    createChannel.mutate({
      brandId: formText(d, 'brandId'),
      body: {
        name: d.get('name'),
        primaryLanguage: d.get('language'),
        secondaryLanguages: [],
        narrativeTone: d.get('tone'),
        shortDurationMinSeconds: null,
        shortDurationMaxSeconds: null,
        strategy: { contractVersion: 1 },
      },
    });
  };
  const projectSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      c = channels.data?.items.find((x) => x.id === d.get('channelId'));
    if (c)
      createProject.mutate({
        contentBrandId: c.contentBrandId,
        channelProfileId: c.id,
        title: d.get('title'),
        description: '',
        format: d.get('format'),
        primaryLanguage: c.primaryLanguage,
        objectiveIds: [formText(d, 'objective')],
        targetPlatformIds: d.getAll('platforms').map(String),
        operatingMode: 'ASSISTED',
      });
  };
  const accountSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    createAccount.mutate({
      channelProfileId: formText(d, 'channelId'),
      platformId: formText(d, 'platformId'),
      displayName: d.get('name'),
      handle: d.get('handle') || null,
      externalAccountId: null,
    });
  };
  const voiceSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    createVoice.mutate({
      name: d.get('name'),
      primaryLanguage: d.get('language'),
      configuration: { contractVersion: 1 },
    });
  };
  const characterSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    createCharacter.mutate({ name: d.get('name'), description: d.get('description') });
  };
  const error =
    createBrand.error ??
    createChannel.error ??
    createProject.error ??
    createAccount.error ??
    createVoice.error ??
    createCharacter.error;
  return (
    <div className="app-shell">
      <aside>
        <div className="brand-mark">
          <span>VM</span>
          <div>
            <strong>VISION MAXSON</strong>
            <small>AI Content Studio</small>
          </div>
        </div>
        <nav aria-label="Product">
          {(
            [
              ['overview', 'Overview'],
              ['brands', 'Brands & Channels'],
              ['profiles', 'Voice & Characters'],
              ['projects', 'Projects'],
              ['accounts', 'Social Accounts'],
              ['strategy', 'Monetization Strategy'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} className={view === id ? 'active' : ''}>
              {label}
            </button>
          ))}
        </nav>
        <div className="identity">
          <span className="status-dot" />
          <div>
            <strong>{me.data?.user.email ?? 'Checking identity'}</strong>
            <small>{me.data?.user.roles.join(', ') ?? 'Cloudflare Access'}</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">PHASE 2 · PRODUCT FOUNDATION</p>
            <h1>
              {
                {
                  overview: 'Workspace',
                  brands: 'Brands & Channels',
                  profiles: 'Voice & Character Profiles',
                  projects: 'Projects',
                  accounts: 'Social Accounts',
                  strategy: 'Monetization Strategy',
                }[view]
              }
            </h1>
          </div>
          <span className="env">
            {me.data?.environment ?? 'checking'} · D1 {me.data?.database ?? 'checking'}
          </span>
        </header>
        {error && (
          <p role="alert" className="notice error">
            {error.message}
          </p>
        )}
        {view === 'overview' && (
          <section className="dashboard">
            <article className="lead">
              <p className="kicker">READY FOR CONFIGURATION</p>
              <h2>Build the editorial system before generating anything.</h2>
              <p>
                Define real brands, channels, targets and monetization intent. Unknown data remains
                unknown; no earnings or analytics are fabricated.
              </p>
            </article>
            <div className="metrics">
              <Metric label="Brands" value={brands.data?.items.length} />
              <Metric label="Channels" value={channels.data?.items.length} />
              <Metric label="Draft projects" value={projects.data?.items.length} />
              <Metric
                label="Connected accounts"
                value={
                  accounts.data?.items.filter((a) => a.connectionStatus === 'connected').length
                }
              />
            </div>
          </section>
        )}
        {view === 'brands' && (
          <div className="two-column">
            <Panel title="Content Brands">
              <form onSubmit={brandSubmit}>
                <Field label="Name" name="name" />
                <Field label="Niche" name="niche" optional />
                <Field label="Primary language" name="language" value="en" />
                <button className="primary">Create brand</button>
              </form>
              <Cards
                empty="No brands yet."
                items={brands.data?.items.map((b) => [
                  b.name,
                  `${b.niche || 'Niche not set'} · ${b.primaryLanguage} · ${b.status}`,
                ])}
              />
            </Panel>
            <Panel title="Channel Setup">
              <form onSubmit={channelSubmit}>
                <label>
                  Brand
                  <select name="brandId" required>
                    <option value="">Select a brand</option>
                    {brands.data?.items.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Channel name" name="name" />
                <Field label="Primary language" name="language" value="en" />
                <Field label="Narrative tone" name="tone" optional />
                <button className="primary">Create channel profile</button>
              </form>
              <Cards
                empty="No channel profiles yet."
                items={channels.data?.items.map((c) => [
                  c.name,
                  `${c.primaryLanguage} · ${c.readinessStatus}`,
                ])}
              />
            </Panel>
          </div>
        )}
        {view === 'projects' && (
          <div className="two-column">
            <Panel title="New project">
              <form onSubmit={projectSubmit}>
                <Field label="Title" name="title" />
                <label>
                  Channel
                  <select name="channelId" required>
                    <option value="">Select a channel</option>
                    {channels.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Format
                  <select name="format">
                    <option value="SHORT">Vertical / Short</option>
                    <option value="LONG_FORM">Long form</option>
                  </select>
                </label>
                <label>
                  Primary objective
                  <select name="objective" required>
                    {catalogs.data?.objectives.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Platform targets</legend>
                  {catalogs.data?.platforms.map((p) => (
                    <label className="check" key={p.id}>
                      <input type="checkbox" name="platforms" value={p.id} />
                      {p.displayName}
                    </label>
                  ))}
                </fieldset>
                <p className="hint">
                  One reusable master is created. Platform variants are only needed for meaningful
                  adaptations.
                </p>
                <button className="primary">Create draft</button>
              </form>
            </Panel>
            <Panel title="Draft projects">
              <Cards
                empty="No projects yet. Create the first real draft."
                items={projects.data?.items.map((p) => [
                  p.title,
                  `${p.format} · ${p.operatingMode} · ${p.status} · ${p.brandName} / ${p.channelName}`,
                ])}
              />
            </Panel>
          </div>
        )}
        {view === 'accounts' && (
          <Panel title="Social Accounts" wide>
            <p className="notice">
              OAuth is not available in Phase 2. Accounts are references only and contain no
              credentials.
            </p>
            <form onSubmit={accountSubmit}>
              <label>
                Channel
                <select name="channelId" required>
                  <option value="">Select a channel</option>
                  {channels.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Platform
                <select name="platformId" required>
                  {catalogs.data?.platforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Account display name" name="name" />
              <Field label="Handle (optional)" name="handle" optional />
              <button className="primary">Add reference</button>
            </form>
            <Cards
              empty="No accounts added. Account and monetization eligibility remain unknown."
              items={accounts.data?.items.map((a) => [
                a.displayName,
                `${a.platform} · ${a.channelName} · ${a.connectionStatus}`,
              ])}
            />
          </Panel>
        )}
        {view === 'profiles' && (
          <div className="two-column">
            <Panel title="Voice Profiles">
              <form onSubmit={voiceSubmit}>
                <Field label="Name" name="name" />
                <Field label="Primary language" name="language" value="en" />
                <button className="primary">Create voice profile</button>
              </form>
              <Cards
                empty="No voice profiles yet."
                items={voices.data?.items.map((v) => [
                  v.name,
                  `${v.primaryLanguage ?? 'Language unknown'} · ${v.status}`,
                ])}
              />
            </Panel>
            <Panel title="Character Profiles">
              <form onSubmit={characterSubmit}>
                <Field label="Name" name="name" />
                <Field label="Description" name="description" optional />
                <button className="primary">Create character profile</button>
              </form>
              <Cards
                empty="No character profiles yet."
                items={characters.data?.items.map((c) => [
                  c.name,
                  `${c.description || 'Description not set'} · ${c.status}`,
                ])}
              />
            </Panel>
          </div>
        )}
        {view === 'strategy' && (
          <Panel title="Versioned strategy defaults" wide>
            <p className="notice">
              Internal strategy is distinct from external platform policy and never guarantees
              monetization.
            </p>
            <div className="strategy-grid">
              {catalogs.data?.strategyDefaults.map((s) => (
                <article key={s.id}>
                  <span>
                    {s.contentFormat} · priority {s.priority}
                  </span>
                  <h3>{s.platform}</h3>
                  <p>
                    {s.preferredMinSeconds
                      ? `${s.preferredMinSeconds}–${s.preferredMaxSeconds} sec internal preference`
                      : 'No duration preference configured'}
                  </p>
                  <small>{s.rationale}</small>
                </article>
              ))}
            </div>
            <h3>Financial projections</h3>
            <p className="unknown">Unknown — no approved or observed revenue inputs exist.</p>
          </Panel>
        )}
      </main>
    </div>
  );
}
function Field({
  label,
  name,
  value,
  optional = false,
}: {
  label: string;
  name: string;
  value?: string;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <input name={name} defaultValue={value} required={!optional} maxLength={200} />
    </label>
  );
}
function Panel({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`panel${wide ? ' wide' : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <article>
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
    </article>
  );
}
function Cards({ items, empty }: { items: Array<[string, string]> | undefined; empty: string }) {
  return !items?.length ? (
    <p className="empty">{empty}</p>
  ) : (
    <div className="cards">
      {items.map(([title, meta], i) => (
        <article key={`${title}-${i}`}>
          <strong>{title}</strong>
          <small>{meta}</small>
        </article>
      ))}
    </div>
  );
}
