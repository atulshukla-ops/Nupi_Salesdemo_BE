import { IsNull, Not } from "typeorm";
import env from "../configs/env";
import { issueHostToken } from "../sync/hostToken";
import { listSessions } from "../sync/sessions";
import { transcriptSummaryJSON } from "./transcript.service";
import { DEFAULT_OPTIONS, DEFAULT_WELCOME, DemoOptions, DemoWelcome, RunOfShow } from "../constants/types";
import { Demo } from "../entities/demo.entity";
import AppError from "../utils/appError";
import { isUniqueViolation } from "../utils/dbErrors";
import { paginate } from "../utils/pagination";
import { listAssets } from "./asset.service";
import { listProducts } from "./product.service";
import { makeSlug } from "./slug.service";

// ---------- serialisation ----------

export const demoToJSON = (d: Demo) => ({
  id: d.id,
  name: d.name,
  clientName: d.clientName,
  date: d.demoDate,
  slug: d.slug,
  flowId: d.flowId,
  welcome: d.welcome,
  options: d.options,
  runOfShow: d.runOfShow,
  createdBy: d.createdBy,
  updatedBy: d.updatedBy,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lastLiveAt: d.lastLiveAt,
  meetingLink: d.meetingLink
});

export const flowToJSON = (f: Demo) => ({
  id: f.id,
  name: f.name,
  audience: f.audience,
  description: f.description,
  isRecommended: f.isRecommended,
  welcome: f.welcome,
  options: f.options,
  runOfShow: f.runOfShow,
  createdBy: f.createdBy,
  updatedBy: f.updatedBy,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt
});

// ---------- helpers ----------

const defaultHeadline = (client: string) => (client.trim() ? `Welcome, ${client.trim()}` : "Welcome");

/** Whole current library, everything enabled, in library order (what the frontend does today on "New demo"). */
export const buildDefaultRunOfShow = async (): Promise<RunOfShow> => {
  const [products, assets] = await Promise.all([listProducts(), listAssets()]);
  return products.map((p) => ({
    productId: p.id,
    enabled: true,
    items: assets.filter((a) => a.productId === p.id).map((a) => ({ assetId: a.id, enabled: true }))
  }));
};

const findLive = async (id: string, isTemplate: boolean) => {
  const row = await Demo.findOneBy({ id, isTemplate, deletedAt: IsNull() });
  if (!row) throw new AppError(404, isTemplate ? "Standard flow not found" : "Demo not found");
  return row;
};

const findDeleted = async (id: string, isTemplate: boolean) => {
  const row = await Demo.findOneBy({ id, isTemplate, deletedAt: Not(IsNull()) });
  if (!row) throw new AppError(404, isTemplate ? "Deleted standard flow not found" : "Deleted demo not found");
  return row;
};

/** Inserts a client demo with a fresh slug, retrying if the random suffix happens to collide. */
const insertClientDemo = async (fields: Partial<Demo> & { name: string; clientName: string; demoDate: string }) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Demo.create({
        ...fields,
        isTemplate: false,
        slug: makeSlug(fields.demoDate, fields.clientName, fields.name)
      }).save();
    } catch (error) {
      if (!isUniqueViolation(error, "UQ_SDR_Demos_Slug")) throw error;
    }
  }
  throw new AppError(500, "Could not generate a unique invite link, please try again");
};

// ---------- client demos ----------

export const listDemos = async (page: number, take: number) => {
  const [rows, count] = await Demo.findAndCount({
    where: { isTemplate: false, deletedAt: IsNull() },
    order: { createdAt: "DESC" },
    skip: (page - 1) * take,
    take
  });
  return { demos: rows.map(demoToJSON), pagination: paginate(page, take, count) };
};

export const getDemo = async (id: string) => findLive(id, false);

export const createDemo = async (
  input: { name: string; clientName: string; date: string; headline: string; flowId?: string },
  by: string | null
) => {
  let runOfShow: RunOfShow;
  let options: DemoOptions;
  let showAgenda = true;
  let flowId: string | null = null;

  if (input.flowId) {
    const flow = await findLive(input.flowId, true);
    runOfShow = flow.runOfShow;
    options = flow.options;
    showAgenda = flow.welcome.showAgenda;
    flowId = flow.id;
  } else {
    runOfShow = await buildDefaultRunOfShow();
    options = DEFAULT_OPTIONS;
  }

  return insertClientDemo({
    name: input.name,
    clientName: input.clientName,
    demoDate: input.date,
    flowId,
    welcome: { headline: input.headline || defaultHeadline(input.clientName), showAgenda },
    options,
    runOfShow,
    createdBy: by,
    updatedBy: by
  });
};

/** Changing the date or client does NOT change the slug: the invite link may already be shared. */
export const updateDemo = async (
  id: string,
  patch: Partial<{ name: string; clientName: string; date: string; welcome: DemoWelcome; options: DemoOptions; runOfShow: RunOfShow; meetingLink: string | null }>,
  by: string | null
) => {
  const demo = await findLive(id, false);
  const { date, meetingLink, ...rest } = patch;
  Object.assign(demo, rest, { updatedBy: by });
  if (meetingLink !== undefined) demo.meetingLink = meetingLink || null;
  if (date) demo.demoDate = date;
  return demo.save();
};

export const deleteDemo = async (id: string, by: string | null) => {
  const demo = await findLive(id, false);
  demo.deletedAt = new Date();
  demo.updatedBy = by;
  return demo.save();
};

export const restoreDemo = async (id: string, by: string | null) => {
  const demo = await findDeleted(id, false);
  demo.deletedAt = null;
  demo.updatedBy = by;
  return demo.save();
};

/** A copy for another session or client; gets its own new invite link. */
export const duplicateDemo = async (id: string, by: string | null) => {
  const src = await findLive(id, false);
  return insertClientDemo({
    name: `${src.name} (copy)`.slice(0, 120),
    clientName: src.clientName,
    demoDate: src.demoDate!,
    flowId: src.flowId,
    welcome: src.welcome,
    options: src.options,
    runOfShow: src.runOfShow,
    createdBy: by,
    updatedBy: by
  });
};

export const saveDemoAsFlow = async (
  id: string,
  input: { name: string; audience: string; description: string; isRecommended: boolean },
  by: string | null
) => {
  const src = await findLive(id, false);
  return Demo.create({
    isTemplate: true,
    name: input.name,
    audience: input.audience,
    description: input.description,
    isRecommended: input.isRecommended,
    // The headline is client-specific, so a flow starts without one.
    welcome: { headline: "", showAgenda: src.welcome.showAgenda },
    options: src.options,
    runOfShow: src.runOfShow,
    createdBy: by,
    updatedBy: by
  }).save();
};

// ---------- standard flows ----------

export const listFlows = () =>
  Demo.find({
    where: { isTemplate: true, deletedAt: IsNull() },
    order: { isRecommended: "DESC", name: "ASC" }
  });

export const getFlow = async (id: string) => findLive(id, true);

export const createFlow = async (
  input: {
    name: string;
    audience: string;
    description: string;
    isRecommended: boolean;
    welcome?: DemoWelcome;
    options?: DemoOptions;
    runOfShow?: RunOfShow;
  },
  by: string | null
) =>
  Demo.create({
    isTemplate: true,
    name: input.name,
    audience: input.audience,
    description: input.description,
    isRecommended: input.isRecommended,
    welcome: input.welcome ?? DEFAULT_WELCOME,
    options: input.options ?? DEFAULT_OPTIONS,
    runOfShow: input.runOfShow ?? (await buildDefaultRunOfShow()),
    createdBy: by,
    updatedBy: by
  }).save();

export const updateFlow = async (
  id: string,
  patch: Partial<{
    name: string;
    audience: string;
    description: string;
    isRecommended: boolean;
    welcome: DemoWelcome;
    options: DemoOptions;
    runOfShow: RunOfShow;
  }>,
  by: string | null
) => {
  const flow = await findLive(id, true);
  Object.assign(flow, patch, { updatedBy: by });
  return flow.save();
};

/** Deleting a flow never touches client demos already created from it. */
export const deleteFlow = async (id: string, by: string | null) => {
  const flow = await findLive(id, true);
  flow.deletedAt = new Date();
  flow.updatedBy = by;
  return flow.save();
};

export const restoreFlow = async (id: string, by: string | null) => {
  const flow = await findDeleted(id, true);
  flow.deletedAt = null;
  flow.updatedBy = by;
  return flow.save();
};

export const createDemoFromFlow = async (
  flowId: string,
  input: { name?: string; clientName: string; date: string; headline: string },
  by: string | null
) => {
  const flow = await findLive(flowId, true);
  // Without an explicit name the demo takes the flow's name (also used in the invite slug).
  return createDemo({ ...input, name: input.name || flow.name, flowId }, by);
};

// ---------- live console ----------

/** A host token for the console of this demo, plus the relay address to connect to. */
export const issueLiveToken = async (id: string, by: string | null) => {
  const demo = await findLive(id, false);
  const { token, expiresAt } = issueHostToken(demo.id, demo.slug!, by);
  return { token, expiresAt, slug: demo.slug, syncUrl: `${env.publicBaseUrl.replace(/^http/, "ws")}/sync` };
};

export const getDemoSessions = async (id: string) => {
  await findLive(id, false);
  return (await listSessions(id)).map((s) => ({
    id: s.id,
    presenterName: s.presenterName,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    peakViewers: s.peakViewers,
    viewers: s.viewers,
    meetingLink: s.meetingLink,
    transcript: transcriptSummaryJSON(s)
  }));
};

// ---------- public (viewer) ----------

/** What the client's waiting room may show before the presenter connects. Nothing else is exposed. */
export const getPublicDemo = async (slug: string) => {
  const demo = await Demo.findOneBy({ slug, isTemplate: false, deletedAt: IsNull() });
  if (!demo) throw new AppError(404, "This demo link is not valid");
  return { name: demo.name, clientName: demo.clientName, date: demo.demoDate };
};
