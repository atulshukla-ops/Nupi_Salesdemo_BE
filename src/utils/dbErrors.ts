import { QueryFailedError } from "typeorm";

/** True when Postgres rejected a write because of a unique index (error code 23505). */
export const isUniqueViolation = (error: unknown, constraint?: string) => {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = (error as QueryFailedError & { driverError?: { code?: string; constraint?: string } }).driverError;
  return driverError?.code === "23505" && (!constraint || driverError.constraint === constraint);
};
