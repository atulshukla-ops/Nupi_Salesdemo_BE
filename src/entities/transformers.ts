import { ValueTransformer } from "typeorm";

/** pg returns bigint/numeric as strings; expose them as numbers (values here stay far below 2^53). */
export const numberTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null || value === undefined ? null : Number(value))
};
