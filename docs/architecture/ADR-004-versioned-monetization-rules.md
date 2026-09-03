# ADR-004: Separate external monetization rules from internal strategy

Status: Accepted for Phase 2.

External platform/program requirements and VISION MAXSON strategy are different facts. `platform_monetization_rule_versions` stores immutable, effective-dated platform claims with source and verification status. `platform_strategy_rule_versions` stores immutable internal priorities, safety margins and preferences and may reference the external rule that informed it.

The initial TikTok platform baseline is explicitly `unverified`; it is not presented as an externally verified fact. The 65–90 second target and +5 second margin are internal owner-approved strategy only. Updating either model creates a new version and never rewrites historical assessments.

Eligibility keeps `publishable`, `program_rule_match`, `account_eligible`, and `monetization_eligible` separate. Missing evidence produces `null`/unknown. Expected revenue is `null` unless both a valid audience quantity and an approved or observed rate exist.
