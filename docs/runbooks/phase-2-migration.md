# Phase 2 migration runbook

Migration: `0001_phase_2_product_channel_monetization.sql`.

## Local verification

1. Apply `0000` then `0001` to an isolated local D1 persistence directory.
2. Run `PRAGMA foreign_key_check`; an empty result is required.
3. Confirm all Phase 1 tables and append-only audit triggers remain.
4. Confirm 25 Phase 2 tables, four platform seeds, six objective seeds, one explicitly unverified external-rule baseline, and five internal strategy defaults.
5. Confirm immutable rule and assessment triggers exist.

## Remote boundary

Do not run the remote migration without explicit approval. Before approval, list pending migrations and export/record recoverable D1 state. The authorized command will be `pnpm db:migrate:staging`; afterward repeat integrity, seed, Phase 1 preservation and Owner checks. A Worker deployment is a separate operation.
