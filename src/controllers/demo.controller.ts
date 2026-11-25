import { Request, Response } from "express";
import {
  createDemo,
  createDemoFromFlow,
  createFlow,
  deleteDemo,
  deleteFlow,
  demoToJSON,
  duplicateDemo,
  flowToJSON,
  getDemo,
  getDemoSessions,
  getFlow,
  getPublicDemo,
  issueLiveToken,
  listDemos,
  listFlows,
  restoreDemo,
  restoreFlow,
  saveDemoAsFlow,
  updateDemo,
  updateFlow
} from "../services/demo.service";
import asyncHandler from "../utils/asyncHandler";
import { presenterName } from "../utils/presenter";
import { successCallback } from "../utils/successResponse";

// ---------- client demos ----------

export const listDemosHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, take } = req.query as unknown as { page: number; take: number };
  successCallback(res, "success", "DemoList", "Demos loaded", await listDemos(page, take));
});

export const getDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "DemoGet", "Demo loaded", demoToJSON(await getDemo(req.params.id)));
});

export const createDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await createDemo(req.body, presenterName(req));
  successCallback(res, "success", "DemoCreate", "Demo created", demoToJSON(demo));
});

export const updateDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await updateDemo(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "DemoUpdate", "Demo updated", demoToJSON(demo));
});

export const deleteDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await deleteDemo(req.params.id, presenterName(req));
  successCallback(res, "success", "DemoDelete", "Demo moved to Trash", demoToJSON(demo));
});

export const restoreDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await restoreDemo(req.params.id, presenterName(req));
  successCallback(res, "success", "DemoRestore", "Demo restored", demoToJSON(demo));
});

export const duplicateDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await duplicateDemo(req.params.id, presenterName(req));
  successCallback(res, "success", "DemoDuplicate", "Demo duplicated with a new link", demoToJSON(demo));
});

export const saveDemoAsFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const flow = await saveDemoAsFlow(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "DemoSaveAsFlow", "Saved as a standard flow", flowToJSON(flow));
});

export const liveTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "DemoLiveToken", "Console token issued", await issueLiveToken(req.params.id, presenterName(req)));
});

export const demoSessionsHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "DemoSessions", "Live sessions loaded", await getDemoSessions(req.params.id));
});

// ---------- standard flows ----------

export const listFlowsHandler = asyncHandler(async (_req: Request, res: Response) => {
  successCallback(res, "success", "FlowList", "Standard flows loaded", (await listFlows()).map(flowToJSON));
});

export const getFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "FlowGet", "Standard flow loaded", flowToJSON(await getFlow(req.params.id)));
});

export const createFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const flow = await createFlow(req.body, presenterName(req));
  successCallback(res, "success", "FlowCreate", "Standard flow created", flowToJSON(flow));
});

export const updateFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const flow = await updateFlow(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "FlowUpdate", "Standard flow updated", flowToJSON(flow));
});

export const deleteFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const flow = await deleteFlow(req.params.id, presenterName(req));
  successCallback(res, "success", "FlowDelete", "Standard flow moved to Trash", flowToJSON(flow));
});

export const restoreFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const flow = await restoreFlow(req.params.id, presenterName(req));
  successCallback(res, "success", "FlowRestore", "Standard flow restored", flowToJSON(flow));
});

export const demoFromFlowHandler = asyncHandler(async (req: Request, res: Response) => {
  const demo = await createDemoFromFlow(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "FlowCreateDemo", "Client demo created from the flow", demoToJSON(demo));
});

// ---------- public (viewer) ----------

export const publicDemoHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "PublicDemo", "Demo found", await getPublicDemo(req.params.slug));
});
