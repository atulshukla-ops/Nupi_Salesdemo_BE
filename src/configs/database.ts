import "reflect-metadata";
import path from "path";
import { DataSource } from "typeorm";
import env from "./env";

/**
 * Single DataSource for the Sales Demo Room database.
 * Schema changes only happen through reviewed migrations (synchronize is always off).
 */
// Only one export: the TypeORM CLI (npm run migration:*) requires exactly one DataSource export.
const AppDataSource = new DataSource({
  type: "postgres",
  host: env.dbHost,
  port: env.dbPort,
  username: env.dbUserName,
  password: env.dbPassword,
  database: env.dbName,
  schema: env.dbSchema,
  entities: [path.join(__dirname, "../entities/*.entity.{ts,js}")],
  migrations: [path.join(__dirname, "../migrations/*.{ts,js}")],
  migrationsTableName: "T_SDR_Migrations",
  synchronize: false,
  logging: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  }
});

export default AppDataSource;
