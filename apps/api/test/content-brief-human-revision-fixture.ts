import { createHash } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { vi } from 'vitest';
import { briefFixture, actor } from './content-brief-revision-fixture';
import { ContentBriefRevisionCapacityService } from '../src/editorial/content-brief-revision-capacity';
import { EditorialExecutionService } from '../src/editorial/execution';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { ContentBriefHumanRevisionService } from '../src/editorial/content-brief-human-revision';
import type { ContentBriefHumanRevisionCommand } from '@vision-maxson/contracts';
export { actor };
export const corrections: ContentBriefHumanRevisionCommand['changes'] = {
  objective:
    'In einem kurzen, verständlichen Technik-Dokumentarformat die dokumentierte Softwareexception bei einer Zahlenkonvertierung und die Fehlinterpretation von Diagnoseinformationen als Flugdaten erklären. Eine kurze Lehre zum Testen technischer Systeme ausdrücklich als redaktionelle Einordnung formulieren.',
  narrativeAngle:
    'Im Mittelpunkt steht die Konvertierung eines 64-Bit-Gleitkommawerts in eine vorzeichenbehaftete 16-Bit-Ganzzahl, bei der eine interne Softwareexception des Trägheitsreferenzsystems (SRI) auftrat. Der Bordcomputer interpretierte Diagnoseinformationen des ausgefallenen aktiven SRI als Flugdaten und verwendete sie für Flugregelungsberechnungen.',
  hook: 'Zahlenkonvertierung mit Folgen.',
  visualDirection:
    'Schneller, sauberer Tech-Dokumentarstil: Die Kernthese mit dem kurzen Hook sofort als Text und Narration eröffnen. Eine stilisierte Raketenanimation dient als schematische Illustration, nicht als historische Aufnahme. Danach die Datenkonvertierung präzise beschriften: „64-Bit-Gleitkommawert → vorzeichenbehaftete 16-Bit-Ganzzahl“. Eine Exception-Markierung und ein Split-Screen veranschaulichen Diagnoseinformationen und ihre Fehlinterpretation als Flugdaten; keine realen Telemetriedaten oder zusätzlichen Systemdetails erfinden. Falls eine Zeitachse verwendet wird: „H0 = Zündung des Vulcain-Triebwerks“ und „bis ungefähr H0+37 s: Flugführung und Flugbahn normal“. Abschließend eine klar gekennzeichnete Texttafel: „Redaktionelle Lehre: Grenzwerte testen. Exceptions absichern. Systeme ganzheitlich prüfen.“ Diese Lehre ist weder ein historisches Zitat noch eine dem Untersuchungsbericht zugeschriebene Schlussfolgerung.',
  editorialConstraints: [
    'Nicht behaupten, die Konvertierung sei die einzige Ursache des Unfalls gewesen.',
    'Die Kausalkette präzise formulieren: Exception in einem Trägheitsreferenzsystem, Diagnoseinformationen wurden vom Bordcomputer als Flugdaten interpretiert, Flight 501 wich von der Flugbahn ab und zerbrach.',
    'Faktische Eckdaten beibehalten: erster Ariane-5-Start am 4. Juni 1996; Flugführung und Flugbahn waren laut der vorläufigen ESA-Chronologie bis ungefähr H0+37 Sekunden normal. H0 bezeichnet die Zündung des Vulcain-Triebwerks, nicht das Abheben; keine Gleichsetzung mit 37 Sekunden nach dem Abheben.',
    'Keine unbelegte Spekulation über individuelle Schuld oder Motive.',
    'Gérard Le Lanns Einordnung als System-Engineering-Fehler ausdrücklich als seine spätere Interpretation kennzeichnen.',
    'Keine unbelegten Ausschlüsse von Explosions- oder Triebwerksereignissen und keine zusätzlichen Aussagen zur Behandlung der Softwareexception ergänzen.',
    'Allgemeine Empfehlungen zu Tests und Absicherung ausschließlich als redaktionelle Lehre kennzeichnen, nicht als belegte historische Aussage oder Zitat.',
  ],
};
export type Faults = {
  failIndex?: number;
  skipIndex?: number;
  beforeBatch?: () => void;
  afterCommitThrow?: boolean;
  batches: number;
  statements: string[];
  values: SQLInputValue[][];
};
// Seed only a local historical AI run through the existing executor with a test double.
// The human-revision operation itself has no adapter or provider interaction.
export async function humanFixture() {
  const f = await briefFixture();
  f.database.exec(
    "UPDATE editorial_artifacts SET version=3 WHERE id='brief'; UPDATE editorial_artifacts SET version=5 WHERE id='research'",
  );
  f.command.expectedResearchArtifactRevision = 5;
  const c = await new ContentBriefRevisionCapacityService(f.d1, actor, {
    requestId: 'fixture-capacity',
    environment: 'staging',
  }).authorize(f.requestId, 'fixture-capacity', f.command);
  const content = {
    topic:
      'Der Ariane-5-Flug-501-Absturz und die folgenschwere Zahlenkonvertierung in der Bordsoftware',
    objective:
      'In einem kurzen, verständlichen Technik-Dokumentarformat erklären, wie eine nicht abgefangene Softwareexception bei einer Zahlenkonvertierung zur Fehlinterpretation von Diagnosedaten beitrug und warum Systemtests entscheidend sind.',
    audience: 'Programmier-Einsteiger, STEM-Lernende und Technikinteressierte',
    primaryPlatformId: 'YOUTUBE_SHORTS',
    secondaryPlatformIds: ['INSTAGRAM_REELS', 'TIKTOK'],
    productionLanguage: 'de',
    reviewLanguage: 'es',
    format: 'SHORT',
    targetDurationSeconds: 60,
    narrativeAngle:
      'Nicht ein einzelnes Triebwerksproblem, sondern eine 64-Bit-zu-16-Bit-Konvertierung löste in Flight 501 eine Softwareexception aus. Anschließend wurden Diagnoseinformationen als Flugdaten interpretiert.',
    hook: 'Am 4. Juni 1996 brachte keine explodierende Maschine Ariane 5 zuerst aus dem Kurs – sondern eine Zahlenkonvertierung in der Software.',
    tone: 'Klar, sachlich, prägnant und dokumentarisch; technisch korrekt, ohne dramatisierende Alleinschuldzuweisung.',
    cta: 'Folge für weitere kurze Geschichten über Softwarefehler, die Technikgeschichte verändert haben.',
    visualDirection:
      'Schneller, sauberer Tech-Dokumentarstil: Startaufnahme beziehungsweise stilisierte Raketenanimation, dann eine animierte Datenpipeline „64-Bit Float → 16-Bit Integer“, ein sichtbarer Überlauf/Exception-Moment, anschließend ein Split-Screen aus Diagnosedaten und falsch interpretierten Flugdaten. Abschließend eine knappe Lehre als Texttafel: „Grenzwerte testen. Exceptions absichern. Systeme ganzheitlich prüfen.“',
    characterVersionIds: [],
    voiceProfileId: null,
    monetizationStrategy:
      'Organisches Educational-Short zur Reichweiten- und Kanalbindung; keine werblichen Integrationen oder Produktclaims.',
    platformConstraints: [
      'Vertikales 9:16-Format.',
      'Die Kernthese in den ersten 2 Sekunden platzieren.',
      'Deutsche Untertitel einbrennen; technische Begriffe zusätzlich visuell erklären.',
      'Für alle sekundären Plattformen ohne plattformspezifische Wasserzeichen exportieren.',
      'Bei rund 60 Sekunden bleiben und ein schnelles, gut lesbares Schnitttempo verwenden.',
    ],
    editorialConstraints: [
      'Nicht behaupten, die Konvertierung sei die einzige Ursache des Unfalls gewesen.',
      'Die Kausalkette präzise formulieren: Exception in einem Trägheitsreferenzsystem, Diagnoseinformationen wurden vom Bordcomputer als Flugdaten interpretiert, Flight 501 wich von der Flugbahn ab und zerbrach.',
      'Faktische Eckdaten beibehalten: erster Ariane-5-Start am 4. Juni 1996; Flugverlauf bis ungefähr H0+37 Sekunden normal.',
      'Keine unbelegte Spekulation über individuelle Schuld oder Motive.',
      'Gérard Le Lanns Einordnung als System-Engineering-Fehler ausdrücklich als seine spätere Interpretation kennzeichnen.',
    ],
    researchVersionIds: [] as string[],
    userNotes:
      'Projekt ist ausschließlich für die kanonische Phase-3-STAGING-E2E-Produktion vorgesehen. Produktionssprache bleibt Deutsch, obwohl UI- und Review-Locale Spanisch sind.',
  };
  content.researchVersionIds = [f.command.researchVersionId];
  const mock = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
    output: content,
    usage: {
      inputUnits: 1052,
      outputUnits: 797,
      cachedInputUnits: 0,
      reasoningOutputUnits: 77,
      unitName: 'token',
    },
    providerRequestId: 'local-fixture-only',
    safeMetadata: {},
  });
  let parentId: string;
  try {
    const r = await new EditorialExecutionService(f.d1, actor, {
      openAIEnabled: true,
      openAIApiKey: 'fixture',
      openAIBaseUrl: 'https://invalid.test',
      environment: 'staging',
      requestId: 'fixture-generation',
    }).execute(
      'project',
      'CONTENT_BRIEF',
      {
        mode: 'LOCKED',
        preferredProviderKey: 'openai',
        preferredModelKey: 'gpt-5.6-terra',
        inputArtifactVersionId: 'new-idea-v1',
        creativeRegeneration: false,
        contentBriefRevisionCapacityId: c.capacityId,
      },
      'fixture-generation',
    );
    if (r.run.status !== 'SUCCEEDED') throw new Error('Historical local fixture generation failed');
    parentId = String(r.run.outputArtifactVersionId);
  } finally {
    mock.mockRestore();
  }
  f.database.exec(
    `INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('protected-tim','workspace','brand','channel','Protected Tim','DRAFT','SHORT','ASSISTED','de','t','t',1)`,
  );
  const faults: Faults = { batches: 0, statements: [], values: [] };
  const d1 = {
    prepare: (sql: string) => f.d1.prepare(sql),
    batch: (statements: D1PreparedStatement[]) => {
      faults.batches++;
      faults.statements = statements.map((s) => (s as unknown as { sql: string }).sql);
      faults.values = statements.map((s) => (s as unknown as { values: SQLInputValue[] }).values);
      faults.beforeBatch?.();
      const altered = statements.map((s, index) =>
        index === faults.failIndex
          ? f.d1.prepare('SELECT no_such_column FROM editorial_artifacts')
          : index === faults.skipIndex
            ? f.d1.prepare('SELECT 1')
            : s,
      );
      // A D1 batch is isolated: do not expose uncommitted intermediate writes to concurrent reads.
      const result: unknown[] = [];
      f.database.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of altered) {
          const local = statement as unknown as { sql: string; values: SQLInputValue[] };
          const r = f.database.prepare(local.sql).run(...local.values);
          result.push({ meta: { changes: Number(r.changes) } });
        }
        f.database.exec('COMMIT');
      } catch (error) {
        f.database.exec('ROLLBACK');
        throw error;
      }
      if (faults.afterCommitThrow) throw new Error('Response lost after local commit');
      return Promise.resolve(result);
    },
  } as unknown as D1Database;
  return {
    ...f,
    d1,
    parentId,
    content,
    capacity: c,
    faults,
    edit: { expectedArtifactRevision: 4, changes: corrections },
  };
}
export type HumanFixture = Awaited<ReturnType<typeof humanFixture>>;
export const humanService = (f: HumanFixture, who = actor) =>
  new ContentBriefHumanRevisionService(f.d1, who, {
    requestId: 'human-request',
    environment: 'staging',
    accessIssuer: 'https://team.cloudflareaccess.com',
    accessSubject: 'owner-subject',
  });
export const read = (f: HumanFixture, sql: string, ...values: Array<string | number | null>) =>
  f.database.prepare(sql).get(...values)!;
export const snapshot = (f: HumanFixture) =>
  Object.fromEntries(
    (
      f.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [name, f.database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
  );
export function corrupt(f: HumanFixture, table: string, sql: string) {
  const triggers = f.database
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?")
    .all(table) as { name: string; sql: string }[];
  for (const t of triggers) f.database.exec(`DROP TRIGGER ${t.name}`);
  try {
    f.database.exec(sql);
  } finally {
    for (const t of triggers) f.database.exec(t.sql);
  }
}
export const contentHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
