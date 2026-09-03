# Phase 3 local migration and future remote procedure

Migration: `0002_phase_3_editorial_intelligence.sql`.

Current state: validated only against isolated local SQLite/D1-compatible state. It has not been applied to remote staging.

## Local verification

Apply migrations 0000, 0001 and 0002 in order to a disposable database. Confirm 56 domain tables (9 Phase 1, 25 Phase 2, 22 Phase 3), plus the D1 migration ledger, nine prompt-definition catalog seeds, zero provider/model/pricing records and `PRAGMA foreign_key_check` returns no rows. Verify immutable-version and append-only triggers reject update/delete operations.

## Authorized remote operation required next

A future explicit authorization must name staging D1 `vision-maxson-data-staging` (`30385914-561a-42f9-9c81-381dc109e18c`) and permit only migration 0002. Before applying it: verify the database identity, migration ledger, Owner/access identity/role/audit preservation, bootstrap disabled and create a recoverable backup/export. Afterward: verify 0002 exactly once, all tables/indexes/triggers/seeds, no fabricated business data and foreign keys. Stop before Worker deployment unless separately authorized.

Production and Workers `m`/`mm` are never targets of this procedure.
