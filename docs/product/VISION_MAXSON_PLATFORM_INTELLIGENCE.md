# Vision Maxson — Platform Intelligence & Trend Operations Canon

**Status:** CANONICAL PRODUCT/OPERATIONS AUTHORITY

## 1. Purpose

Vision Maxson must optimize content differently for YouTube, TikTok, Facebook and Instagram. Platform rules, monetization programs, distribution behavior, duration thresholds, originality requirements and recommendation systems change over time and must not be treated as one generic social-media profile.

The system must therefore maintain a continuously refreshed **Platform Intelligence** layer.

Core principle:

> Optimize for eligibility, quality, retention, reach and monetization **within** platform rules. Never design for policy circumvention.

## 2. Dynamic platform rules

Vision Maxson must maintain a versioned platform-rule registry with at least:

- platform;
- program/product;
- country/region;
- account/channel eligibility;
- content-format eligibility;
- duration constraints;
- originality/reused-content rules;
- monetization mechanics;
- ad/mid-roll conditions where applicable;
- music/copyright constraints;
- current source URL;
- last verified time;
- effective date;
- confidence/evidence status.

Rules must be sourced preferentially from official platform documentation. They must be reverified because platform policies change.

## 3. Current reference examples (verified September 2026)

These are examples, not permanent constants.

### TikTok Creator Rewards

Current official support documentation states that qualifying videos must be original, high-quality and at least one minute / longer than one minute depending on the support page wording. Vision Maxson should therefore treat a 59-second clip as **not eligible** for Creator Rewards and should use a safety target above 60 seconds when Creator Rewards is an explicit goal, unless current official rules change.

Do not artificially pad content merely to cross a threshold. If the content does not justify the required duration, select a different monetization/distribution objective.

### YouTube long-form

Current YouTube documentation allows mid-roll ads on monetized videos of **8 minutes or longer**.

There is no canonical 25-minute monetization threshold. A 25-minute video may create more natural opportunities for ad breaks than a 4-minute video, but Vision Maxson must not stretch content merely for ad inventory. Retention, completion, viewer satisfaction and topic depth remain primary.

### YouTube Shorts

Current YouTube rules allow qualifying vertical/square Shorts up to 3 minutes under the Shorts monetization model. Classification and monetization rules must be checked against the current upload date and current official documentation.

### Facebook

Facebook Content Monetization is performance-based and covers eligible short- and long-form video/reels and other eligible formats. Facebook has unified video publishing toward Reels and emphasizes original content, deeper engagement, longer watch time and qualified views.

### Instagram

Instagram monetization is product-specific rather than governed by one universal duration threshold. Vision Maxson must inspect the currently available monetization product/account eligibility (for example gifts, subscriptions, partnership/branded opportunities, or other active programs) rather than applying TikTok or YouTube rules to Instagram.

## 4. Duration optimizer

Vision Maxson must choose duration from:

- platform/program constraints;
- topic depth;
- expected retention;
- narrative structure;
- monetization opportunity;
- channel historical performance;
- target audience;
- current trend/performance data.

It must **not** optimize duration by blindly maximizing length.

Examples:

- TikTok Creator Rewards objective: satisfy current minimum qualifying duration while preserving retention.
- YouTube long-form: exceed 8 minutes only when the content naturally supports it and mid-roll opportunity is relevant.
- A 4-minute video may be preferable to a 25-minute video if the subject is exhausted at 4 minutes.
- A 25-minute video may be preferable when the topic genuinely supports deeper storytelling and retention.

## 5. Platform-specific publishing intelligence

Before publishing, Vision Maxson should calculate a platform-specific recommendation including:

- format/aspect ratio;
- duration;
- title/hook;
- description;
- captions/subtitles;
- thumbnail/cover;
- hashtags/keywords where relevant;
- CTA;
- publishing window;
- monetization eligibility;
- originality/reused-content risk;
- rights/copyright state;
- likely platform-specific constraints.

The system may create distinct derivatives from one master rather than force one identical file onto every platform.

## 6. Trend Agent

The original Vision Maxson concept includes a **TREND AGENT** that can analyze:

- YouTube trends;
- TikTok trends;
- Facebook/Instagram trends where accessible;
- Google Trends;
- news;
- AI news;
- platform trend/creator tools;
- channel historical analytics.

The Trend Agent should identify:

- emerging topics;
- trending formats;
- viral hooks;
- high-performing content structures;
- rising search terms;
- reusable editorial opportunities;
- ranking/list opportunities.

Trend discovery does not itself authorize copying third-party media.

## 7. Ranking / Top-N content workflow

Vision Maxson may support ranking formats such as:

- Top 5;
- Top 6;
- Top 10;
- best/worst;
- before/after;
- comparison;
- countdown;
- ranked compilation with original editorial value.

Canonical workflow:

```text
Trend discovery
  ↓
Candidate collection
  ↓
Source/rights verification
  ↓
Original ranking thesis / criteria
  ↓
Research
  ↓
Original script / narration / analysis
  ↓
Source asset intake
  ↓
Transformative editing / graphics / commentary
  ↓
QA + originality/rights review
  ↓
Platform-specific master
```

A simple stitching of other creators' clips, minor speed changes, borders, captions or generic narration is not sufficient as a monetization-safe originality strategy.

## 8. Source video / clip intake

Watermark-free does **not** mean rights-free.

Vision Maxson may ingest third-party clips only when there is a valid basis to use them, such as:

- owned media;
- licensed media;
- explicit permission;
- platform-provided remix/reuse rights;
- public-domain/compatible licensed sources;
- other legally valid use reviewed under the project policy.

Do not bypass DRM, private access, platform security, or paid access controls.

## 9. API-first + manual bridge

Preferred order:

1. official API or approved integration;
2. direct source URL when allowed;
3. user-provided file/link;
4. manual bridge when automation is unavailable or unreliable.

If Vision Maxson cannot automatically retrieve a permitted source clip, it should surface the source URL and required metadata to the owner. The owner may paste the URL/file back into the project, after which Vision Maxson can ingest it under the source/rights policy.

This preserves the previously approved **API-first + OAuth + manual bridge** architecture.

## 10. Source ledger

Every externally sourced clip used in a ranking or compilation should have metadata such as:

- source platform;
- canonical URL;
- creator/source name;
- retrieval/import method;
- rights/licence/permission status;
- watermark state;
- original publication date when known;
- project usage;
- transformation notes;
- attribution requirements;
- monetization-risk status.

## 11. Originality protection

Platform Intelligence must warn or block when a proposed compilation is likely to be treated as low-value reused/unoriginal content.

Vision Maxson should prefer:

- original research;
- original editorial framing;
- original narration;
- meaningful analysis;
- material transformation;
- unique graphics/data/context;
- clear ranking rationale;
- licensed or owned media.

## 12. Continuous updates

Platform rules are not static product constants.

The system should periodically review official platform sources and flag:

- policy changes;
- new monetization products;
- changed duration thresholds;
- changed eligibility criteria;
- new originality/reused-content guidance;
- API/publishing changes;
- changes affecting Shorts/Reels/long-form classification.

Changes should be versioned, dated and surfaced through **Actualidades** / Platform Intelligence when materially relevant.

## 13. Historical decision continuity

The Trend Agent, platform-specific optimization, ranking-video workflow and manual-link fallback are part of the historical Vision Maxson automation concept and must not be dropped merely because later implementation phases focus on other subsystems.
