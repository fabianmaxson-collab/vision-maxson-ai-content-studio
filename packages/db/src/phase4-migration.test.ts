import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function createMigratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const dir = fileURLToPath(new URL('../migrations', import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec(sql);
  }
  return db;
}

function seedFoundation(db: DatabaseSync) {
  db.exec(`
    INSERT INTO workspaces(id, slug, name, created_at, updated_at, version)
      VALUES('w1', 'w1', 'Workspace 1', 'now', 'now', 1);
    INSERT INTO workspaces(id, slug, name, created_at, updated_at, version)
      VALUES('w2', 'w2', 'Workspace 2', 'now', 'now', 1);
    INSERT INTO users(id, workspace_id, email, status, created_at, updated_at, version)
      VALUES('u1', 'w1', 'owner@example.com', 'active', 'now', 'now', 1);
    INSERT INTO content_brands(id, workspace_id, name, normalized_name, primary_language, created_at, updated_at, version)
      VALUES('b1', 'w1', 'Brand 1', 'brand1', 'es', 'now', 'now', 1);
    INSERT INTO channel_profiles(id, workspace_id, content_brand_id, name, normalized_name, primary_language, created_at, updated_at, version)
      VALUES('c1', 'w1', 'b1', 'Channel 1', 'channel1', 'es', 'now', 'now', 1);
    INSERT INTO projects(id, workspace_id, content_brand_id, channel_profile_id, title, format, operating_mode, primary_language, created_at, updated_at, version)
      VALUES('p1', 'w1', 'b1', 'c1', 'Project 1', 'SHORT', 'ASSISTED', 'es', 'now', 'now', 1);
    INSERT INTO projects(id, workspace_id, content_brand_id, channel_profile_id, title, format, operating_mode, primary_language, created_at, updated_at, version)
      VALUES('p2', 'w1', 'b1', 'c1', 'Project 2', 'SHORT', 'ASSISTED', 'es', 'now', 'now', 1);
    INSERT INTO editorial_artifacts(id, workspace_id, project_id, artifact_type, current_version_id, status, created_at, updated_at, version)
      VALUES('art_sb1', 'w1', 'p1', 'STORYBOARD', 'sb_v1', 'approved', 'now', 'now', 1);
    INSERT INTO editorial_artifact_versions(id, workspace_id, artifact_id, version_number, language_code, source_type, content_text, content_hash, created_at, created_by)
      VALUES('sb_v1', 'w1', 'art_sb1', 1, 'es', 'HUMAN_EDITED', 'Storyboard script and beats', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'now', 'u1');
    INSERT INTO storyboard_scenes(id, workspace_id, storyboard_version_id, scene_order, visual_description, location, action, camera_framing, mood, continuity_notes, generation_instructions, asset_requirements_json, transition_notes, character_version_refs_json, created_at)
      VALUES('sc1', 'w1', 'sb_v1', 1, 'Scene 1 description', 'Studio', 'Host speaks', 'WIDE', 'Calm', 'None', 'Standard', '[]', 'Cut', '[]', 'now');
    INSERT INTO ai_providers(id, key, display_name, status, adapter_version, created_at, updated_at, version)
      VALUES('prov_luma', 'luma', 'Luma AI', 'configured', 'v1', 'now', 'now', 1);
    INSERT INTO ai_providers(id, key, display_name, status, adapter_version, created_at, updated_at, version)
      VALUES('prov_runway', 'runway', 'Runway', 'configured', 'v1', 'now', 'now', 1);
    INSERT INTO ai_provider_models(id, provider_id, model_key, display_name, status, capabilities_json, effective_from, created_at, updated_at, version)
      VALUES('mod_ray2', 'prov_luma', 'ray-2', 'Ray 2', 'available', '{"video":true}', 'now', 'now', 'now', 1);
    INSERT INTO ai_provider_models(id, provider_id, model_key, display_name, status, capabilities_json, effective_from, created_at, updated_at, version)
      VALUES('mod_gen3', 'prov_runway', 'gen-3', 'Gen 3', 'available', '{"video":true}', 'now', 'now', 'now', 1);
  `);
}

function insertValidSpp(db: DatabaseSync, id = 'spp1', sceneId = 'sc1') {
  db.exec(`
    INSERT INTO scene_production_plans(
      id, workspace_id, project_id, source_storyboard_version_id, scene_id, scene_order,
      script_segment_ids_json, target_duration_seconds, aspect_ratio, visual_strategy, media_type,
      visual_description, prompt_intent, negative_constraints_json, continuity_key,
      continuity_reference_keys_json, camera_framing, camera_movement, motion_pacing,
      lighting_style, safe_area_guidance_json, on_screen_elements_json, captions_json,
      audio_requirements_json, factual_restrictions_json, rights_requirements, quality_tier,
      cost_ceiling_microusd, approval_status, version, created_at, updated_at
    ) VALUES (
      '${id}', 'w1', 'p1', 'sb_v1', '${sceneId}', 1,
      '["seg1"]', 5.0, '16:9', 'GENERATIVE_VIDEO', 'VIDEO',
      'Visual description', 'Prompt intent', '[]', NULL,
      '[]', 'WIDE', 'STATIC', 'MEASURED',
      'STUDIO', '{"safe":true}', '[]', '{"required":true}',
      '{"vo":true}', '[]', 'ORIGINAL_GENERATIVE', 'PRODUCTION',
      500000, 'DRAFT', 1, 'now', 'now'
    );
  `);
}

describe('Phase 4 Audiovisual Persistence — Migration 0017', () => {
  it('A. SCHEMA: replaying 0000-0017 creates all 8 Phase 4 tables with expected columns', () => {
    const db = createMigratedDatabase();
    const tables = [
      'scene_production_plans',
      'video_generation_intents',
      'provider_routing_decisions',
      'audiovisual_generation_jobs',
      'audiovisual_generation_attempts',
      'media_assets',
      'media_asset_inspections',
      'media_asset_source_links',
    ];
    for (const table of tables) {
      const row = db
        .prepare(`SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table) as { cnt: number };
      expect(row.cnt).toBe(1);
    }

    // Verify columns on media_assets: drive_file_id exists, ephemeral URL column does NOT exist
    const columns = db.prepare(`PRAGMA table_info(media_assets)`).all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('drive_file_id');
    expect(colNames).toContain('r2_key');
    expect(colNames).toContain('generation_attempt_id');
    expect(colNames).not.toContain('providerEphemeralUrl');
    expect(colNames).not.toContain('encrypted_transient_download_url');
    expect(colNames).not.toContain('publicDownloadUrl');
  });

  it('B. SPP: lineage, referential checks, version guard, and terminal immutability', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);

    // Valid SPP succeeds
    insertValidSpp(db, 'spp1');

    // Wrong storyboard version rejected
    expect(() => {
      db.exec(`
        INSERT INTO scene_production_plans(
          id, workspace_id, project_id, source_storyboard_version_id, scene_id, scene_order,
          script_segment_ids_json, target_duration_seconds, aspect_ratio, visual_strategy, media_type,
          visual_description, prompt_intent, camera_framing, camera_movement, motion_pacing,
          lighting_style, safe_area_guidance_json, captions_json, audio_requirements_json,
          rights_requirements, quality_tier, cost_ceiling_microusd, approval_status, version
        ) VALUES (
          'spp_bad_ver', 'w1', 'p1', 'nonexistent_version', 'sc1', 1,
          '[]', 5.0, '16:9', 'GENERATIVE_VIDEO', 'VIDEO',
          'Desc', 'Intent', 'WIDE', 'STATIC', 'MEASURED',
          'STUDIO', '{}', '{}', '{}',
          'ORIGINAL_GENERATIVE', 'PRODUCTION', 500000, 'DRAFT', 1
        );
      `);
    }).toThrow(/spp_storyboard_version_invalid/);

    // Wrong scene rejected (version exists, scene does not)
    expect(() => {
      db.exec(`
        INSERT INTO scene_production_plans(
          id, workspace_id, project_id, source_storyboard_version_id, scene_id, scene_order,
          script_segment_ids_json, target_duration_seconds, aspect_ratio, visual_strategy, media_type,
          visual_description, prompt_intent, camera_framing, camera_movement, motion_pacing,
          lighting_style, safe_area_guidance_json, captions_json, audio_requirements_json,
          rights_requirements, quality_tier, cost_ceiling_microusd, approval_status, version
        ) VALUES (
          'spp_bad_scene', 'w1', 'p1', 'sb_v1', 'nonexistent_scene', 1,
          '[]', 5.0, '16:9', 'GENERATIVE_VIDEO', 'VIDEO',
          'Desc', 'Intent', 'WIDE', 'STATIC', 'MEASURED',
          'STUDIO', '{}', '{}', '{}',
          'ORIGINAL_GENERATIVE', 'PRODUCTION', 500000, 'DRAFT', 1
        );
      `);
    }).toThrow(/spp_storyboard_scene_invalid/);

    // Version increment optimistic lock test
    expect(() => {
      db.exec(`UPDATE scene_production_plans SET version = 1 WHERE id = 'spp1';`);
    }).toThrow(/spp_optimistic_lock_failed/);

    // Valid version update succeeds
    db.exec(
      `UPDATE scene_production_plans SET version = 2, approval_status = 'APPROVED' WHERE id = 'spp1';`,
    );

    // Terminal immutability: once APPROVED, creative fields cannot change
    expect(() => {
      db.exec(
        `UPDATE scene_production_plans SET version = 3, visual_description = 'Changed' WHERE id = 'spp1';`,
      );
    }).toThrow(/spp_terminal_mutation_forbidden/);

    // But bookkeeping (version + updated_at) is permitted
    db.exec(
      `UPDATE scene_production_plans SET version = 3, updated_at = 'tomorrow' WHERE id = 'spp1';`,
    );
  });

  it('C. INTENT: provider-neutral, uniqueness, append-only, and frame scope', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');

    // Insert valid intent
    db.exec(`
      INSERT INTO video_generation_intents(
        id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number,
        target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt,
        negative_prompt, cost_ceiling_microusd, idempotency_key
      ) VALUES (
        'int1', 'w1', 'p1', 'spp1', 'sc1', 1,
        5.0, '16:9', 'PRODUCTION', 'A beautiful cinematic landscape',
        'blurry', 500000, 'idem-intent-1'
      );
    `);

    // Duplicate take number for same plan rejected
    expect(() => {
      db.exec(`
        INSERT INTO video_generation_intents(
          id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number,
          target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt,
          cost_ceiling_microusd, idempotency_key
        ) VALUES (
          'int2', 'w1', 'p1', 'spp1', 'sc1', 1,
          5.0, '16:9', 'PRODUCTION', 'Different prompt',
          500000, 'idem-intent-2'
        );
      `);
    }).toThrow(/UNIQUE constraint failed/);

    // Duplicate idempotency_key rejected
    expect(() => {
      db.exec(`
        INSERT INTO video_generation_intents(
          id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number,
          target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt,
          cost_ceiling_microusd, idempotency_key
        ) VALUES (
          'int3', 'w1', 'p1', 'spp1', 'sc1', 2,
          5.0, '16:9', 'PRODUCTION', 'Take 2 prompt',
          500000, 'idem-intent-1'
        );
      `);
    }).toThrow(/UNIQUE constraint failed/);

    // Intent is strictly append-only
    expect(() => {
      db.exec(`UPDATE video_generation_intents SET prompt = 'Updated' WHERE id = 'int1';`);
    }).toThrow(/intent_update_forbidden/);

    expect(() => {
      db.exec(`DELETE FROM video_generation_intents WHERE id = 'int1';`);
    }).toThrow(/intent_delete_forbidden/);
  });

  it('D. ROUTING: intent scope, provider/model catalog ownership, and append-only', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(
        id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number,
        target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt,
        cost_ceiling_microusd, idempotency_key
      ) VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
    `);

    // Mismatched provider and model ownership (mod_gen3 belongs to prov_runway, NOT prov_luma)
    expect(() => {
      db.exec(`
        INSERT INTO provider_routing_decisions(
          id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id,
          capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp
        ) VALUES (
          'rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_gen3',
          'v1', 400000, 'Lowest cost', '{"cost":true}', '2026-09-26T00:00:00Z'
        );
      `);
    }).toThrow(/routing_provider_model_ownership_invalid/);

    // Valid routing decision succeeds
    db.exec(`
      INSERT INTO provider_routing_decisions(
        id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id,
        capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp
      ) VALUES (
        'rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_ray2',
        'v1', 400000, 'Lowest cost', '{"cost":true}', '2026-09-26T00:00:00Z'
      );
    `);

    // Append-only
    expect(() => {
      db.exec(
        `UPDATE provider_routing_decisions SET routing_reason = 'Changed' WHERE id = 'rout1';`,
      );
    }).toThrow(/routing_update_forbidden/);

    expect(() => {
      db.exec(`DELETE FROM provider_routing_decisions WHERE id = 'rout1';`);
    }).toThrow(/routing_delete_forbidden/);
  });

  it('E. JOB: exactly 15 states, legal transitions, illegal jumps, terminal immutability, and 1-to-1 with Intent', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(
        id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number,
        target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt,
        cost_ceiling_microusd, idempotency_key
      ) VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
    `);

    // Valid initial job
    db.exec(`
      INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
        VALUES('job1', 'w1', 'p1', 'int1', 'PLANNED', 1);
    `);

    // Duplicate Job for same intent rejected (1 Job per Intent Take)
    expect(() => {
      db.exec(`
        INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
          VALUES('job2', 'w1', 'p1', 'int1', 'PLANNED', 1);
      `);
    }).toThrow(/UNIQUE constraint failed/);

    // Illegal jump: PLANNED -> PERSISTED rejected
    expect(() => {
      db.exec(
        `UPDATE audiovisual_generation_jobs SET version = 2, state = 'PERSISTED' WHERE id = 'job1';`,
      );
    }).toThrow(/jobs_illegal_state_transition/);

    // Legal sequence: PLANNED -> RESERVED -> DISPATCHING -> POLLING -> PROVIDER_COMPLETED -> INGESTING -> VALIDATING -> NORMALIZING -> VALIDATING -> ARCHIVING -> PERSISTED
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 2, state = 'RESERVED' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 3, state = 'DISPATCHING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 4, state = 'POLLING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 5, state = 'PROVIDER_COMPLETED' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 6, state = 'INGESTING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 7, state = 'VALIDATING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 8, state = 'NORMALIZING' WHERE id = 'job1';`,
    );
    // Re-validation after normalization succeeds!
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 9, state = 'VALIDATING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 10, state = 'ARCHIVING' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 11, state = 'PERSISTED' WHERE id = 'job1';`,
    );

    // Terminal job is permanently immutable
    expect(() => {
      db.exec(
        `UPDATE audiovisual_generation_jobs SET version = 12, state = 'FAILED_CLOSED' WHERE id = 'job1';`,
      );
    }).toThrow(/jobs_terminal_state_immutable/);
  });

  it('F. ATTEMPT: uniqueness, routing consistency, technical retry under same Take/Job', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number, target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt, cost_ceiling_microusd, idempotency_key)
        VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
      INSERT INTO provider_routing_decisions(id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id, capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp)
        VALUES ('rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_ray2', 'v1', 400000, 'Reason 1', '{}', '2026-09-26T00:00:00Z');
      INSERT INTO provider_routing_decisions(id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id, capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp)
        VALUES ('rout2', 'w1', 'p1', 'int1', 'prov_runway', 'mod_gen3', 'v1', 420000, 'Failover Reason', '{}', '2026-09-26T00:01:00Z');
      INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
        VALUES('job1', 'w1', 'p1', 'int1', 'DISPATCHING', 1);
    `);

    // Create Attempt #1
    db.exec(`
      INSERT INTO audiovisual_generation_attempts(
        id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number,
        provider_id, provider_model_id, state, estimated_cost_microusd, idempotency_key
      ) VALUES (
        'att1', 'w1', 'p1', 'job1', 'rout1', 1,
        'prov_luma', 'mod_ray2', 'DISPATCHING', 400000, 'idem-att-1'
      );
    `);

    // Duplicate attempt number rejected
    expect(() => {
      db.exec(`
        INSERT INTO audiovisual_generation_attempts(
          id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number,
          provider_id, provider_model_id, state, estimated_cost_microusd, idempotency_key
        ) VALUES (
          'att1_dup', 'w1', 'p1', 'job1', 'rout1', 1,
          'prov_luma', 'mod_ray2', 'DISPATCHING', 400000, 'idem-att-dup'
        );
      `);
    }).toThrow(/UNIQUE constraint failed/);

    // Attempt #1 fails
    db.exec(
      `UPDATE audiovisual_generation_attempts SET state = 'FAILED', error_category = 'PROVIDER_INTERNAL' WHERE id = 'att1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 2, state = 'PROVIDER_FAILED' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 3, state = 'BACKOFF_WAIT' WHERE id = 'job1';`,
    );
    db.exec(
      `UPDATE audiovisual_generation_jobs SET version = 4, state = 'DISPATCHING' WHERE id = 'job1';`,
    );

    // Technical retry creates Attempt #2 under SAME Job and SAME Take (int1)
    db.exec(`
      INSERT INTO audiovisual_generation_attempts(
        id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number,
        provider_id, provider_model_id, state, estimated_cost_microusd, idempotency_key
      ) VALUES (
        'att2', 'w1', 'p1', 'job1', 'rout2', 2,
        'prov_runway', 'mod_gen3', 'DISPATCHING', 420000, 'idem-att-2'
      );
    `);

    // Confirm both attempts exist under Job 1 and only 1 intent exists
    const attCount = db
      .prepare(
        `SELECT count(*) as cnt FROM audiovisual_generation_attempts WHERE generation_job_id = 'job1'`,
      )
      .get() as { cnt: number };
    expect(attCount.cnt).toBe(2);
    const intentCount = db
      .prepare(`SELECT count(*) as cnt FROM video_generation_intents`)
      .get() as { cnt: number };
    expect(intentCount.cnt).toBe(1);
  });

  it('G. ATTEMPT SECRET: one-way scrub, provenance immutability, and re-population rejection', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number, target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt, cost_ceiling_microusd, idempotency_key)
        VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
      INSERT INTO provider_routing_decisions(id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id, capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp)
        VALUES ('rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_ray2', 'v1', 400000, 'R', '{}', '2026-09-26T00:00:00Z');
      INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
        VALUES('job1', 'w1', 'p1', 'int1', 'DISPATCHING', 1);
      INSERT INTO audiovisual_generation_attempts(
        id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number,
        provider_id, provider_model_id, state, encrypted_transient_download_url, transient_download_expires_at,
        estimated_cost_microusd, idempotency_key
      ) VALUES (
        'att1', 'w1', 'p1', 'job1', 'rout1', 1,
        'prov_luma', 'mod_ray2', 'COMPLETED', 'ciphertext_envelope_base64', '2026-09-26T01:00:00Z',
        400000, 'idem-key'
      );
    `);

    // Terminal provenance tampering rejected (e.g. changing provider or costs)
    expect(() => {
      db.exec(
        `UPDATE audiovisual_generation_attempts SET estimated_cost_microusd = 100 WHERE id = 'att1';`,
      );
    }).toThrow(/attempts_terminal_provenance_immutable/);

    // One-way secret scrub succeeds
    db.exec(`
      UPDATE audiovisual_generation_attempts
      SET encrypted_transient_download_url = NULL,
          transient_download_expires_at = NULL,
          secret_scrubbed_at = '2026-09-26T00:30:00Z',
          updated_at = 'now'
      WHERE id = 'att1';
    `);

    // Re-population of scrubbed secret rejected
    expect(() => {
      db.exec(
        `UPDATE audiovisual_generation_attempts SET encrypted_transient_download_url = 'new_cipher' WHERE id = 'att1';`,
      );
    }).toThrow(/attempts_terminal_url_scrub_only/);

    // Mutating secret_scrubbed_at once set rejected
    expect(() => {
      db.exec(
        `UPDATE audiovisual_generation_attempts SET secret_scrubbed_at = '2026-09-26T00:40:00Z' WHERE id = 'att1';`,
      );
    }).toThrow(/attempts_secret_scrubbed_at_immutable/);
  });

  it('H. MEDIA ASSET: raw with attempt, normalized with NULL attempt, storage checks, and provenance immutability', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number, target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt, cost_ceiling_microusd, idempotency_key)
        VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
      INSERT INTO provider_routing_decisions(id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id, capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp)
        VALUES ('rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_ray2', 'v1', 400000, 'R', '{}', '2026-09-26T00:00:00Z');
      INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
        VALUES('job1', 'w1', 'p1', 'int1', 'DISPATCHING', 1);
      INSERT INTO audiovisual_generation_attempts(id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number, provider_id, provider_model_id, state, estimated_cost_microusd, idempotency_key)
        VALUES ('att1', 'w1', 'p1', 'job1', 'rout1', 1, 'prov_luma', 'mod_ray2', 'COMPLETED', 400000, 'idem-att-1');
    `);

    // TRANSIENT_OPERATIONAL without r2_key rejected
    expect(() => {
      db.exec(`
        INSERT INTO media_assets(
          id, workspace_id, project_id, generation_attempt_id, asset_type, file_hash_sha256, mime_type, file_size_bytes,
          storage_state, estimated_cost_microusd
        ) VALUES (
          'ast_bad', 'w1', 'p1', 'att1', 'VIDEO_CLIP',
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'video/mp4', 1000,
          'TRANSIENT_OPERATIONAL', 400000
        );
      `);
    }).toThrow(/CHECK constraint failed/);

    // Raw asset with valid attempt and r2_key succeeds
    db.exec(`
      INSERT INTO media_assets(
        id, workspace_id, project_id, generation_attempt_id, asset_type, file_hash_sha256, mime_type, file_size_bytes,
        storage_state, r2_key, estimated_cost_microusd
      ) VALUES (
        'ast_raw', 'w1', 'p1', 'att1', 'VIDEO_CLIP',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'video/mp4', 1000,
        'TRANSIENT_OPERATIONAL', 'raw/ast_raw.mp4', 400000
      );
    `);

    // Normalized asset with generation_attempt_id = NULL and Drive archive succeeds
    db.exec(`
      INSERT INTO media_assets(
        id, workspace_id, project_id, generation_attempt_id, asset_type, file_hash_sha256, mime_type, file_size_bytes,
        storage_state, r2_key, drive_file_id, estimated_cost_microusd
      ) VALUES (
        'ast_norm', 'w1', 'p1', NULL, 'FINAL_MASTER',
        'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', 'video/mp4', 2000,
        'DURABLE_ARCHIVED', NULL, 'drive_file_123', 450000
      );
    `);

    // Immutable provenance cannot change on update
    expect(() => {
      db.exec(
        `UPDATE media_assets SET version = 2, file_hash_sha256 = '0000000000000000000000000000000000000000000000000000000000000000' WHERE id = 'ast_raw';`,
      );
    }).toThrow(/media_assets_provenance_immutable/);

    // Watermark cannot silently reset true -> false
    db.exec(`UPDATE media_assets SET version = 2, watermark_detected = 1 WHERE id = 'ast_raw';`);
    expect(() => {
      db.exec(`UPDATE media_assets SET version = 3, watermark_detected = 0 WHERE id = 'ast_raw';`);
    }).toThrow(/media_assets_watermark_cannot_reset/);
  });

  it('I. INSPECTION: canonical status enum, append-only, and asset scoping', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    db.exec(`
      INSERT INTO media_assets(
        id, workspace_id, project_id, asset_type, file_hash_sha256, mime_type, file_size_bytes,
        storage_state, r2_key, estimated_cost_microusd
      ) VALUES (
        'ast1', 'w1', 'p1', 'VIDEO_CLIP',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'video/mp4', 1000,
        'TRANSIENT_OPERATIONAL', 'r2/ast1.mp4', 100000
      );
    `);

    // Non-canonical status rejected (e.g. PASSED instead of PASS)
    expect(() => {
      db.exec(`
        INSERT INTO media_asset_inspections(
          id, workspace_id, project_id, media_asset_id, status, actual_width, actual_height,
          calculated_aspect_ratio, actual_duration_seconds, fps, container, video_codec,
          audio_present, file_size_bytes, sha256, black_frame_detected, frozen_frame_detected,
          watermark_detected, declared_vs_actual_mismatch, normalization_required
        ) VALUES (
          'insp_bad', 'w1', 'p1', 'ast1', 'PASSED', 1920, 1080,
          '16:9', 5.0, 30.0, 'mp4', 'h264',
          0, 1000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 0, 0, 0, 0
        );
      `);
    }).toThrow(/CHECK constraint failed/);

    // Valid inspection succeeds
    db.exec(`
      INSERT INTO media_asset_inspections(
        id, workspace_id, project_id, media_asset_id, status, actual_width, actual_height,
        calculated_aspect_ratio, actual_duration_seconds, fps, container, video_codec,
        audio_present, file_size_bytes, sha256, black_frame_detected, frozen_frame_detected,
        watermark_detected, declared_vs_actual_mismatch, normalization_required
      ) VALUES (
        'insp1', 'w1', 'p1', 'ast1', 'PASS', 1920, 1080,
        '16:9', 5.0, 30.0, 'mp4', 'h264',
        0, 1000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 0, 0, 0, 0
      );
    `);

    // Append-only
    expect(() => {
      db.exec(`UPDATE media_asset_inspections SET status = 'FAIL' WHERE id = 'insp1';`);
    }).toThrow(/inspections_update_forbidden/);

    expect(() => {
      db.exec(`DELETE FROM media_asset_inspections WHERE id = 'insp1';`);
    }).toThrow(/inspections_delete_forbidden/);
  });

  it('J. SOURCE LINKS: self-link rejected, cross-project rejected, valid relation succeeds, and append-only', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    db.exec(`
      INSERT INTO media_assets(id, workspace_id, project_id, asset_type, file_hash_sha256, mime_type, file_size_bytes, storage_state, r2_key, estimated_cost_microusd)
        VALUES ('ast_p1_a', 'w1', 'p1', 'VIDEO_CLIP', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'video/mp4', 1000, 'TRANSIENT_OPERATIONAL', 'k1', 100);
      INSERT INTO media_assets(id, workspace_id, project_id, asset_type, file_hash_sha256, mime_type, file_size_bytes, storage_state, r2_key, estimated_cost_microusd)
        VALUES ('ast_p1_b', 'w1', 'p1', 'VIDEO_CLIP', 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', 'video/mp4', 1000, 'TRANSIENT_OPERATIONAL', 'k2', 100);
      INSERT INTO media_assets(id, workspace_id, project_id, asset_type, file_hash_sha256, mime_type, file_size_bytes, storage_state, r2_key, estimated_cost_microusd)
        VALUES ('ast_p2_c', 'w1', 'p2', 'VIDEO_CLIP', '4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce', 'video/mp4', 1000, 'TRANSIENT_OPERATIONAL', 'k3', 100);
    `);

    // Self-link rejected
    expect(() => {
      db.exec(
        `INSERT INTO media_asset_source_links(workspace_id, target_asset_id, source_asset_id, link_type) VALUES('w1', 'ast_p1_a', 'ast_p1_a', 'NORMALIZED_FROM');`,
      );
    }).toThrow(/source_links_self_link_forbidden/);

    // Cross-project link rejected
    expect(() => {
      db.exec(
        `INSERT INTO media_asset_source_links(workspace_id, target_asset_id, source_asset_id, link_type) VALUES('w1', 'ast_p1_a', 'ast_p2_c', 'NORMALIZED_FROM');`,
      );
    }).toThrow(/source_links_cross_project_forbidden/);

    // Valid relation between same-project assets succeeds
    db.exec(
      `INSERT INTO media_asset_source_links(workspace_id, target_asset_id, source_asset_id, link_type) VALUES('w1', 'ast_p1_b', 'ast_p1_a', 'NORMALIZED_FROM');`,
    );

    // Append-only
    expect(() => {
      db.exec(`UPDATE media_asset_source_links SET link_type = 'DERIVED_FROM';`);
    }).toThrow(/source_links_update_forbidden/);

    expect(() => {
      db.exec(`DELETE FROM media_asset_source_links WHERE target_asset_id = 'ast_p1_b';`);
    }).toThrow(/source_links_delete_forbidden/);
  });

  it('K. JSON VALIDATION: malformed JSON and wrong JSON top-level types rejected', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);

    // Malformed JSON on SPP rejected
    expect(() => {
      db.exec(`
        INSERT INTO scene_production_plans(
          id, workspace_id, project_id, source_storyboard_version_id, scene_id, scene_order,
          script_segment_ids_json, target_duration_seconds, aspect_ratio, visual_strategy, media_type,
          visual_description, prompt_intent, camera_framing, camera_movement, motion_pacing,
          lighting_style, safe_area_guidance_json, captions_json, audio_requirements_json,
          rights_requirements, quality_tier, cost_ceiling_microusd, approval_status, version
        ) VALUES (
          'spp_mal', 'w1', 'p1', 'sb_v1', 'sc1', 1,
          '{not_an_array}', 5.0, '16:9', 'GENERATIVE_VIDEO', 'VIDEO',
          'Desc', 'Intent', 'WIDE', 'STATIC', 'MEASURED',
          'STUDIO', '{}', '{}', '{}',
          'ORIGINAL_GENERATIVE', 'PRODUCTION', 500000, 'DRAFT', 1
        );
      `);
    }).toThrow(/CHECK constraint failed/);

    // Object instead of array on SPP script_segment_ids_json rejected
    expect(() => {
      db.exec(`
        INSERT INTO scene_production_plans(
          id, workspace_id, project_id, source_storyboard_version_id, scene_id, scene_order,
          script_segment_ids_json, target_duration_seconds, aspect_ratio, visual_strategy, media_type,
          visual_description, prompt_intent, camera_framing, camera_movement, motion_pacing,
          lighting_style, safe_area_guidance_json, captions_json, audio_requirements_json,
          rights_requirements, quality_tier, cost_ceiling_microusd, approval_status, version
        ) VALUES (
          'spp_mal2', 'w1', 'p1', 'sb_v1', 'sc1', 1,
          '{"key":"val"}', 5.0, '16:9', 'GENERATIVE_VIDEO', 'VIDEO',
          'Desc', 'Intent', 'WIDE', 'STATIC', 'MEASURED',
          'STUDIO', '{}', '{}', '{}',
          'ORIGINAL_GENERATIVE', 'PRODUCTION', 500000, 'DRAFT', 1
        );
      `);
    }).toThrow(/CHECK constraint failed/);
  });

  it('L. DELETE POLICY: all 8 Phase 4 tables reject hard delete', () => {
    const db = createMigratedDatabase();
    seedFoundation(db);
    insertValidSpp(db, 'spp1');
    db.exec(`
      INSERT INTO video_generation_intents(id, workspace_id, project_id, scene_production_plan_id, scene_id, take_number, target_duration_seconds, target_aspect_ratio, target_quality_tier, prompt, cost_ceiling_microusd, idempotency_key)
        VALUES ('int1', 'w1', 'p1', 'spp1', 'sc1', 1, 5.0, '16:9', 'PRODUCTION', 'P', 500000, 'idem-intent-key-1');
      INSERT INTO provider_routing_decisions(id, workspace_id, project_id, video_generation_intent_id, provider_id, provider_model_id, capability_profile_version, estimated_cost_microusd, routing_reason, routing_factors_json, decision_timestamp)
        VALUES ('rout1', 'w1', 'p1', 'int1', 'prov_luma', 'mod_ray2', 'v1', 400000, 'R', '{}', '2026-09-26T00:00:00Z');
      INSERT INTO audiovisual_generation_jobs(id, workspace_id, project_id, video_generation_intent_id, state, version)
        VALUES('job1', 'w1', 'p1', 'int1', 'PLANNED', 1);
      INSERT INTO audiovisual_generation_attempts(id, workspace_id, project_id, generation_job_id, routing_decision_id, attempt_number, provider_id, provider_model_id, state, estimated_cost_microusd, idempotency_key)
        VALUES ('att1', 'w1', 'p1', 'job1', 'rout1', 1, 'prov_luma', 'mod_ray2', 'DISPATCHING', 400000, 'idem-att-key-1');
      INSERT INTO media_assets(id, workspace_id, project_id, generation_attempt_id, asset_type, file_hash_sha256, mime_type, file_size_bytes, storage_state, r2_key, estimated_cost_microusd)
        VALUES ('ast1', 'w1', 'p1', 'att1', 'VIDEO_CLIP', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'video/mp4', 1000, 'TRANSIENT_OPERATIONAL', 'k1', 100);
      INSERT INTO media_assets(id, workspace_id, project_id, generation_attempt_id, asset_type, file_hash_sha256, mime_type, file_size_bytes, storage_state, r2_key, estimated_cost_microusd)
        VALUES ('ast2', 'w1', 'p1', 'att1', 'VIDEO_CLIP', 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', 'video/mp4', 1000, 'TRANSIENT_OPERATIONAL', 'k2', 100);
      INSERT INTO media_asset_inspections(id, workspace_id, project_id, media_asset_id, status, actual_width, actual_height, calculated_aspect_ratio, actual_duration_seconds, fps, container, video_codec, audio_present, file_size_bytes, sha256, black_frame_detected, frozen_frame_detected, watermark_detected, declared_vs_actual_mismatch, normalization_required)
        VALUES ('insp1', 'w1', 'p1', 'ast1', 'PASS', 1920, 1080, '16:9', 5.0, 30.0, 'mp4', 'h264', 0, 1000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 0, 0, 0, 0);
      INSERT INTO media_asset_source_links(workspace_id, target_asset_id, source_asset_id, link_type)
        VALUES ('w1', 'ast2', 'ast1', 'NORMALIZED_FROM');
    `);

    // Verify all 8 reject DELETE
    expect(() => db.exec(`DELETE FROM scene_production_plans;`)).toThrow(/spp_delete_forbidden/);
    expect(() => db.exec(`DELETE FROM video_generation_intents;`)).toThrow(
      /intent_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM provider_routing_decisions;`)).toThrow(
      /routing_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM audiovisual_generation_jobs;`)).toThrow(
      /jobs_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM audiovisual_generation_attempts;`)).toThrow(
      /attempts_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM media_assets WHERE id = 'ast1';`)).toThrow(
      /media_assets_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM media_asset_inspections;`)).toThrow(
      /inspections_delete_forbidden/,
    );
    expect(() => db.exec(`DELETE FROM media_asset_source_links;`)).toThrow(
      /source_links_delete_forbidden/,
    );
  });
});
