import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ReviewReadAloud } from './components/review-read-aloud/ReviewReadAloud';
import { translate } from './i18n';
type Catalogs = {
  platforms: Array<{ id: string; key: string; displayName: string }>;
  objectives: Array<{ id: string; displayName: string }>;
  strategyDefaults: Array<{
    id: string;
    platform: string;
    contentFormato: string;
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
    const b = (await r.json().catch(() => ({ detail: 'La solicitud ha fallado' }))) as {
      detail?: string;
    };
    throw new Error(b.detail ?? 'La solicitud ha fallado');
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
      | 'overview'
      | 'brands'
      | 'profiles'
      | 'projects'
      | 'accounts'
      | 'strategy'
      | 'intelligence'
      | 'settings'
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
              ['overview', translate('nav.overview')],
              ['brands', translate('nav.brands')],
              ['profiles', translate('nav.profiles')],
              ['projects', translate('nav.projects')],
              ['accounts', translate('nav.accounts')],
              ['strategy', translate('nav.strategy')],
              ['intelligence', translate('nav.intelligence')],
              ['settings', translate('nav.settings')],
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
            <strong>{me.data?.user.email ?? 'Comprobando identidad'}</strong>
            <small>{me.data?.user.roles.join(', ') ?? 'Cloudflare Access'}</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">PHASE 3 · PLANIFICACIÓN EDITORIAL</p>
            <h1>
              {
                {
                  overview: 'Espacio de trabajo',
                  brands: 'Marcas y Canales',
                  profiles: 'Perfiles de Voz y Personajes',
                  projects: 'Proyectos',
                  accounts: 'Cuentas Sociales',
                  strategy: 'Estrategia de Monetización',
                  intelligence: 'Inteligencia IA',
                  settings: 'Configuración',
                }[view]
              }
            </h1>
          </div>
          <span className="env">
            {me.data?.environment ?? 'comprobando'} · D1 {me.data?.database ?? 'comprobando'}
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
              <p className="kicker">LISTO PARA CONFIGURAR</p>
              <h2>Prepara el sistema editorial antes de generar contenido.</h2>
              <p>
                Define marcas, canales, destinos y objetivos reales. Los datos desconocidos siguen
                siendo desconocidos; no se inventan ingresos ni analíticas.
              </p>
            </article>
            <div className="metrics">
              <Metric label="Marcas" value={brands.data?.items.length} />
              <Metric label="Canales" value={channels.data?.items.length} />
              <Metric label="Proyectos borrador" value={projects.data?.items.length} />
              <Metric
                label="Cuentas conectadas"
                value={
                  accounts.data?.items.filter((a) => a.connectionStatus === 'connected').length
                }
              />
            </div>
          </section>
        )}
        {view === 'brands' && (
          <div className="two-column">
            <Panel title="Marcas de contenido">
              <form onSubmit={brandSubmit}>
                <Field label="Nombre" name="name" />
                <Field label="Nicho" name="niche" optional />
                <Field label="Idioma principal" name="language" value="en" />
                <button className="primary">Crear marca</button>
              </form>
              <Cards
                empty="Todavía no hay marcas."
                items={brands.data?.items.map((b) => [
                  b.name,
                  `${b.niche || 'Nicho not set'} · ${b.primaryLanguage} · ${b.status}`,
                ])}
              />
            </Panel>
            <Panel title="Configuración del canal">
              <form onSubmit={channelSubmit}>
                <label>
                  Marca
                  <select name="brandId" required>
                    <option value="">Selecciona una marca</option>
                    {brands.data?.items.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Nombre del canal" name="name" />
                <Field label="Idioma principal" name="language" value="en" />
                <Field label="Tono narrativo" name="tone" optional />
                <button className="primary">Crear perfil de canal</button>
              </form>
              <Cards
                empty="Todavía no hay perfiles de canal."
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
            <Panel title="Nuevo proyecto">
              <form onSubmit={projectSubmit}>
                <Field label="Título" name="title" />
                <label>
                  Canal
                  <select name="channelId" required>
                    <option value="">Selecciona un canal</option>
                    {channels.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Formato
                  <select name="format">
                    <option value="SHORT">Vertical / Short</option>
                    <option value="LONG_FORM">Formato largo</option>
                  </select>
                </label>
                <label>
                  Objetivo principal
                  <select name="objective" required>
                    {catalogs.data?.objectives.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Plataformas destino</legend>
                  {catalogs.data?.platforms.map((p) => (
                    <label className="check" key={p.id}>
                      <input type="checkbox" name="platforms" value={p.id} />
                      {p.displayName}
                    </label>
                  ))}
                </fieldset>
                <p className="hint">
                  One reusable master is created. Plataforma variants are only needed for meaningful
                  adaptations.
                </p>
                <button className="primary">Crear borrador</button>
              </form>
            </Panel>
            <Panel title="Proyectos en borrador">
              <Cards
                empty="Todavía no hay proyectos. Crea el primer borrador real."
                items={projects.data?.items.map((p) => [
                  p.title,
                  `${p.format} · ${p.operatingMode} · ${p.status} · ${p.brandName} / ${p.channelName}`,
                ])}
              />
            </Panel>
          </div>
        )}
        {view === 'accounts' && (
          <Panel title="Cuentas sociales" wide>
            <p className="notice">
              OAuth is not available in Phase 2. Accounts are references only and contain no
              credentials.
            </p>
            <form onSubmit={accountSubmit}>
              <label>
                Canal
                <select name="channelId" required>
                  <option value="">Selecciona un canal</option>
                  {channels.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Plataforma
                <select name="platformId" required>
                  {catalogs.data?.platforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Nombre visible de la cuenta" name="name" />
              <Field label="Handle (opcional)" name="handle" optional />
              <button className="primary">Añadir referencia</button>
            </form>
            <Cards
              empty="No hay cuentas añadidas. La elegibilidad de cuenta y monetización sigue siendo desconocida."
              items={accounts.data?.items.map((a) => [
                a.displayName,
                `${a.platform} · ${a.channelName} · ${a.connectionStatus}`,
              ])}
            />
          </Panel>
        )}
        {view === 'profiles' && (
          <div className="two-column">
            <Panel title="Perfiles de voz">
              <form onSubmit={voiceSubmit}>
                <Field label="Nombre" name="name" />
                <Field label="Idioma principal" name="language" value="en" />
                <button className="primary">Crear perfil de voz</button>
              </form>
              <Cards
                empty="Todavía no hay perfiles de voz."
                items={voices.data?.items.map((v) => [
                  v.name,
                  `${v.primaryLanguage ?? 'Idioma desconocido'} · ${v.status}`,
                ])}
              />
            </Panel>
            <Panel title="Perfiles de personajes">
              <form onSubmit={characterSubmit}>
                <Field label="Nombre" name="name" />
                <Field label="Descripción" name="description" optional />
                <button className="primary">Crear perfil de personaje</button>
              </form>
              <Cards
                empty="Todavía no hay perfiles de personajes."
                items={characters.data?.items.map((c) => [
                  c.name,
                  `${c.description || 'Descripción sin definir'} · ${c.status}`,
                ])}
              />
            </Panel>
          </div>
        )}
        {view === 'strategy' && (
          <Panel title="Estrategia versionada predeterminada" wide>
            <p className="notice">
              La estrategia interna es distinta de las reglas externas de plataforma y nunca
              garantiza monetización.
            </p>
            <div className="strategy-grid">
              {catalogs.data?.strategyDefaults.map((s) => (
                <article key={s.id}>
                  <span>
                    {s.contentFormato} · priority {s.priority}
                  </span>
                  <h3>{s.platform}</h3>
                  <p>
                    {s.preferredMinSeconds
                      ? `${s.preferredMinSeconds}–${s.preferredMaxSeconds} sec internal preference`
                      : 'Sin preferencia de duración configurada'}
                  </p>
                  <small>{s.rationale}</small>
                </article>
              ))}
            </div>
            <h3>Proyecciones financieras</h3>
            <p className="unknown">
              Desconocido: no existen datos de ingresos aprobados u observados.
            </p>
          </Panel>
        )}
        {view === 'intelligence' && (
          <Panel title="Inteligencia IA" wide>
            <p className="notice">{translate('ai.notConfigured')}</p>
            <p>
              La arquitectura editorial está preparada para investigación, ideas, brief, guion,
              revisión en español, crítica, storyboard y preflight. No se generará contenido hasta
              que el Owner apruebe y configure un proveedor real.
            </p>
            <EditorialWorkspace projects={projects.data?.items ?? []} />
          </Panel>
        )}
        {view === 'settings' && (
          <Panel title="Configuración" wide>
            <p className="notice">
              Idioma de interfaz: español. El idioma de producción se configura por proyecto.
            </p>
          </Panel>
        )}
      </main>
    </div>
  );
}
type EditorialArtifact = {
  artifactType: string;
  currentVersionId: string | null;
  versionNumber: number | null;
  languageCode: string | null;
  contentText: string | null;
};
const workspaceTabs = [
  ['summary', 'Resumen', null],
  ['research', 'Investigación', 'RESEARCH'],
  ['ideas', 'Ideas', 'IDEA_CANDIDATE'],
  ['brief', 'Brief', 'CONTENT_BRIEF'],
  ['script', 'Guion', 'PRODUCTION_SCRIPT'],
  ['storyboard', 'Storyboard', 'STORYBOARD'],
  ['preflight', 'Preflight', 'PREFLIGHT'],
] as const;
function EditorialWorkspace({ projects }: { projects: Project[] }) {
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState<(typeof workspaceTabs)[number][0]>('summary');
  const artifacts = useQuery({
    queryKey: ['editorial-artifacts', projectId],
    queryFn: () =>
      api<{ items: EditorialArtifact[] }>(`/projects/${projectId}/editorial-artifacts`),
    enabled: Boolean(projectId),
  });
  const artifactType = workspaceTabs.find(([id]) => id === tab)?.[2];
  const visible = (artifacts.data?.items ?? []).filter(
    (artifact) => artifactType === null || artifact.artifactType === artifactType,
  );
  return (
    <section className="editorial-workspace" aria-label="Espacio editorial del proyecto">
      <label>
        Proyecto
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Selecciona un proyecto real</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <div className="workspace-tabs" role="tablist" aria-label="Flujo editorial">
        {workspaceTabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!projectId ? (
        <p className="empty">Selecciona un proyecto para revisar sus artefactos editoriales.</p>
      ) : artifacts.isLoading ? (
        <p>Consultando artefactos…</p>
      ) : !visible.length ? (
        <p className="empty">No hay artefactos reales en esta sección.</p>
      ) : (
        <div className="artifact-list">
          {visible.map((artifact) => (
            <article key={artifact.currentVersionId ?? artifact.artifactType}>
              <small>
                {artifact.artifactType} · versión {artifact.versionNumber ?? '—'}
              </small>
              {artifact.artifactType === 'PRODUCTION_SCRIPT' && <h3>GUION DE PRODUCCIÓN</h3>}
              {artifact.artifactType === 'REVIEW_TRANSLATION' && (
                <h3>VERSIÓN PARA REVISIÓN · Español</h3>
              )}
              {artifact.contentText && (
                <>
                  <p className="artifact-text">{artifact.contentText}</p>
                  <ReviewReadAloud
                    text={artifact.contentText}
                    language={artifact.languageCode ?? 'es'}
                  />
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
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
