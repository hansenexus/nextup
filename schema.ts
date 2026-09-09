/**
 * roadmap.yaml — the shape, as Zod 4 schemas.
 *
 * One file answers "what are we doing, in what order, and how far along is
 * it". It deliberately has NO free date fields on phases or items: a phase may
 * name a quarter (`target: 2026-Q4`) and a milestone may carry a day-date, but
 * only together with a `source` that says who committed to it and when. A date
 * somebody computed is not a date — it renders as a draft.
 *
 * Text fields accept a plain string or a `{ locale: string }` map, so a public
 * roadmap can be bilingual without a second file. `meta.locales[0]` is the
 * fallback locale.
 *
 * `schema/roadmap.schema.json` is generated from `roadmapSchema` by
 * `bun run schema:gen`; `schema.test.ts` fails when the committed JSON drifts.
 */

import { z } from "zod";

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** A year, a quarter or a half — never a day. */
export const TARGET_PATTERN = /^\d{4}(-Q[1-4]|-H[12])?$/;

export const idSchema = z.string().regex(ID_PATTERN, "id: letters, digits and dashes only");
export const dateSchema = z.string().regex(DATE_PATTERN, "date: YYYY-MM-DD");
export const targetSchema = z
  .string()
  .regex(TARGET_PATTERN, "target: YYYY, YYYY-Q1..Q4 or YYYY-H1..H2 (never a day)");

/** `"Learn"` or `{ en: "Learn", de: "Lernen" }`. */
export const localizedStringSchema = z.union([
  z.string().min(1),
  z
    .record(z.string().regex(LOCALE_PATTERN, "locale: xx or xx-XX"), z.string().min(1))
    .refine((map) => Object.keys(map).length > 0, "at least one locale"),
]);

export const visibilitySchema = z.enum(["public", "internal"]);
export const itemKindSchema = z.enum(["theme", "epic", "wave"]);

/**
 * Values a human may WRITE, and only while nothing is linked: `proposed` and
 * `planned` for what has no issues yet, `done` for what shipped before the
 * roadmap existed (with `since` saying when), `dropped` for what was cut.
 * Everything in between is derived from linked issues.
 */
export const manualItemStatusSchema = z.enum(["proposed", "planned", "done", "dropped"]);
/** Values a reader may SEE. */
export const itemStatusSchema = z.enum([
  "proposed",
  "planned",
  "in-progress",
  "blocked",
  "done",
  "dropped",
]);
export const horizonSchema = z.enum(["shipped", "carry-over", "now", "next", "later"]);
export const milestoneStatusSchema = z.enum(["draft", "planned", "reached", "dropped"]);
export const sourceKindSchema = z.enum(["decision", "commitment", "contract", "release", "user"]);

export const DEFAULT_LABELS = {
  in_progress: ["status:in-progress", "status/in-progress", "status:review", "status/review"],
  blocked: ["status:blocked", "status:needs-human", "status/blocked", "blocked"],
  done: ["status/done"],
  ready: ["ready", "status/ready"],
} as const;

/**
 * How THIS repo spells task state on its issues. The defaults cover the two
 * taxonomies in the wild (fleet `status:*`, board `status/*`); a repo with its
 * own vocabulary lists it here instead of relabelling every issue.
 */
export const labelsSchema = z.strictObject({
  in_progress: z.array(z.string()).default([...DEFAULT_LABELS.in_progress]),
  blocked: z.array(z.string()).default([...DEFAULT_LABELS.blocked]),
  done: z.array(z.string()).default([...DEFAULT_LABELS.done]),
  ready: z.array(z.string()).default([...DEFAULT_LABELS.ready]),
  /** phase id → label, used only to report unlinked issues per phase. */
  phase: z.record(z.string(), z.string()).default({}),
});

export const presentationSchema = z.strictObject({
  /** Public readers never see "blocked": it is an internal state. */
  show_blocked_as: z.enum(["in-progress", "planned"]).default("in-progress"),
});

export const metaSchema = z.strictObject({
  project: z.string().regex(SLUG_PATTERN, "project: lowercase slug"),
  repo: z.string().regex(REPO_PATTERN, "repo: owner/name"),
  title: localizedStringSchema,
  locales: z.array(z.string().regex(LOCALE_PATTERN)).min(1).default(["en"]),
  /** Monotonic. Bump on any change a public reader could notice. */
  version: z.number().int().positive(),
  updated: dateSchema,
  /** `false` refuses to emit a public projection at all. */
  public: z.boolean().default(false),
  public_url: z.url().nullable().default(null),
  current_phase: idSchema,
  labels: labelsSchema.default({
    in_progress: [...DEFAULT_LABELS.in_progress],
    blocked: [...DEFAULT_LABELS.blocked],
    done: [...DEFAULT_LABELS.done],
    ready: [...DEFAULT_LABELS.ready],
    phase: {},
  }),
  /** Default `fleet-<env>` pin for dispatched issues. */
  fleet_env: z.string().nullable().default(null),
  /** Directory of mechanics wave files, relative to the repo root. */
  mechanics_waves: z.string().nullable().default(null),
  /** Monorepo: only issues carrying this label belong to this roadmap. */
  scope: z.strictObject({ label: z.string().nullable().default(null) }).default({ label: null }),
  presentation: presentationSchema.default({ show_blocked_as: "in-progress" }),
});

export const phaseSchema = z.strictObject({
  id: idSchema,
  title: localizedStringSchema,
  goal: localizedStringSchema.optional(),
  gets_you: localizedStringSchema.optional(),
  target: targetSchema.optional(),
  /** `internal` hides the phase AND every item in it from the public projection. */
  visibility: visibilitySchema.default("public"),
});

export const linkSchema = z.strictObject({
  title: z.string().min(1),
  url: z.string().min(1),
});

export const taskSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  acceptance: z.array(z.string().min(1)).min(1, "a task needs at least one acceptance criterion"),
  verify: z.array(z.string().min(1)).min(1, "a task needs at least one verification command"),
  /** Task ids in this item, or `<item-id>/<task-id>` for another item's task. */
  blocked_by: z.array(z.string().min(1)).default([]),
  labels: z.array(z.string().min(1)).default([]),
  fleet_env: z.string().nullable().default(null),
  interactive: z.boolean().default(false),
});

export const itemSchema = z.strictObject({
  id: idSchema,
  aliases: z.array(idSchema).default([]),
  title: localizedStringSchema,
  /** Required when public. Public-safe by construction: no issue numbers, no names. */
  summary: localizedStringSchema.optional(),
  description: z.string().optional(),
  phase: idSchema,
  kind: itemKindSchema.default("epic"),
  area: z.string().optional(),
  visibility: visibilitySchema.default("internal"),
  depends_on: z.array(idSchema).default([]),
  /** Issues linked by hand. Dispatched tasks link themselves via body markers. */
  issues: z.array(z.number().int().positive()).default([]),
  tasks: z.array(taskSchema).default([]),
  /** Manual status: only while nothing is linked, and only with `since`. */
  status: manualItemStatusSchema.optional(),
  since: dateSchema.optional(),
  reason: z.string().optional(),
  /** `done` additionally requires this wave file to be all green. */
  mechanics_wave: z.string().nullable().default(null),
  owners: z.array(z.string()).default([]),
  notes: z.string().optional(),
  links: z.array(linkSchema).default([]),
  /** Reserved for the client-portal tier. Must stay empty in schema 1. */
  clients: z.array(z.string()).default([]),
});

export const sourceSchema = z.strictObject({
  kind: sourceKindSchema,
  ref: z.string().optional(),
  by: z.string().min(1),
  at: dateSchema,
});

export const milestoneSchema = z.strictObject({
  id: idSchema,
  title: localizedStringSchema,
  summary: localizedStringSchema.optional(),
  phase: idSchema,
  items: z.array(idSchema).default([]),
  status: milestoneStatusSchema.default("draft"),
  /** A day-date. Present ⇒ `source` present and status planned|reached. */
  date: dateSchema.nullable().default(null),
  source: sourceSchema.nullable().default(null),
  reached_at: dateSchema.nullable().default(null),
  reason: z.string().optional(),
  visibility: visibilitySchema.default("public"),
});

export const roadmapSchema = z.strictObject({
  schema: z.literal(1),
  meta: metaSchema,
  phases: z.array(phaseSchema).min(1, "at least one phase"),
  items: z.array(itemSchema).default([]),
  milestones: z.array(milestoneSchema).default([]),
});

/**
 * A host's skin, for `serve`'s harness only: the stylesheets a consuming app
 * wraps the component in, so the preview shows what that app will show rather
 * than the package defaults. Never read by `build` — a projection carries no
 * styling, and a skin must not be able to change what is published.
 */
export const skinSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lower-case slug"),
  label: z.string().min(1).optional(),
  /** Applied in order, after the component's own stylesheet. */
  css: z.array(z.string().min(1)).min(1),
  /** Class on a wrapper around the roadmap, when the host scopes its tokens. */
  wrapper: z.string().min(1).optional(),
  /** Class the host sets for its dark ground, when it does not use the media query. */
  dark: z.string().min(1).optional(),
  /** Stylesheet URLs to load first (webfonts). */
  links: z.array(z.url()).optional(),
});

/** `nextup.config.yaml` at a repo root: which roadmap files `--all` walks. */
export const configSchema = z.strictObject({
  roadmaps: z.array(z.string().min(1)).min(1),
  skins: z.array(skinSchema).optional(),
});

/** Estate config for `build --estate`: roadmaps fetched from GitHub, no checkouts. */
export const estateSchema = z.strictObject({
  repos: z
    .array(
      z.strictObject({
        repo: z.string().regex(REPO_PATTERN),
        files: z.array(z.string().min(1)).min(1).default(["roadmap.yaml"]),
        ref: z.string().optional(),
      })
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Projections. Consumers `safeParse` a fetched roadmap.public.json against
// `publicRoadmapSchema` before rendering it.
// ---------------------------------------------------------------------------

export const publicPhaseSchema = z.object({
  id: z.string(),
  title: localizedStringSchema,
  goal: localizedStringSchema.optional(),
  gets_you: localizedStringSchema.optional(),
  target: z.string().optional(),
  horizon: z.enum(["done", "now", "next", "later"]),
  progress: z.object({ done: z.number().int(), total: z.number().int() }),
});

export const publicItemSchema = z.object({
  id: z.string(),
  title: localizedStringSchema,
  summary: localizedStringSchema.optional(),
  phase: z.string(),
  horizon: horizonSchema,
  status: itemStatusSchema,
  kind: itemKindSchema,
  area: z.string().optional(),
  depends_on: z.array(z.string()),
  links: z.array(linkSchema),
  since: z.string().optional(),
});

export const publicMilestoneSchema = z.object({
  id: z.string(),
  title: localizedStringSchema,
  summary: localizedStringSchema.optional(),
  phase: z.string(),
  status: milestoneStatusSchema,
  date: z.string().nullable(),
  source_kind: sourceKindSchema.nullable(),
  reached_at: z.string().nullable(),
});

export const publicRoadmapSchema = z.object({
  schema: z.literal(1),
  audience: z.literal("public"),
  project: z.string(),
  title: localizedStringSchema,
  locales: z.array(z.string()),
  version: z.number().int(),
  updated: z.string(),
  generated_at: z.string(),
  stale: z.boolean(),
  stale_reason: z.string().nullable(),
  current_phase: z.string(),
  phases: z.array(publicPhaseSchema),
  items: z.array(publicItemSchema),
  milestones: z.array(publicMilestoneSchema),
});

/** JSON Schema for editors (`# yaml-language-server: $schema=…`) and CI. */
export function roadmapJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(roadmapSchema, { target: "draft-2020-12", io: "input" });
  return {
    ...generated,
    $id: "https://nextup.hansenexus.dev/schema/roadmap.schema.json",
    title: "nextup roadmap.yaml",
  };
}
