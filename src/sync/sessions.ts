import { IsNull } from "typeorm";
import { SessionViewer } from "../constants/types";
import { Demo } from "../entities/demo.entity";
import { DemoSession } from "../entities/demoSession.entity";

/** Database side of the relay: one T_SDR_Demo_Sessions row per live run of a demo. */

export const openSession = async (demoId: string, presenterName: string | null) => {
  const session = await DemoSession.create({ demoId, presenterName, startedAt: new Date(), peakViewers: 0, viewers: [] }).save();
  await Demo.update({ id: demoId }, { lastLiveAt: new Date() });
  return session;
};

export const saveSessionViewers = (sessionId: string, viewers: SessionViewer[], peakViewers: number) =>
  DemoSession.update({ id: sessionId }, { viewers, peakViewers });

export const endSession = (sessionId: string, viewers: SessionViewer[], peakViewers: number) =>
  DemoSession.update({ id: sessionId }, { viewers, peakViewers, endedAt: new Date() });

/** After a restart no console is connected, so sessions left open by the previous process are closed. */
export const closeStaleSessions = async () => {
  const result = await DemoSession.update({ endedAt: IsNull() }, { endedAt: new Date() });
  return result.affected ?? 0;
};

export const listSessions = (demoId: string) =>
  DemoSession.find({ where: { demoId }, order: { startedAt: "DESC" }, take: 50 });
