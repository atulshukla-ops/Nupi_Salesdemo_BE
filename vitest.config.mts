import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Automated tests. They need no database or running server: the settings below are set before any
 * app code loads (dotenv never overrides them), and files go to a temporary folder.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      TEAM_KEY: "test-team-key-0123456789",
      HOST_TOKEN_SECRET: "test-host-token-secret-0123456789abcdef",
      CORS_ORIGINS: "http://localhost:5180",
      PUBLIC_BASE_URL: "http://localhost:8130",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: path.join(os.tmpdir(), `sdr-test-storage-${process.pid}`),
      UPLOAD_PART_BYTES: String(1024 * 1024),
      API_DOCS: "true",
      DB_NAME: "not_used_by_tests",
      DB_USERNAME: "not_used_by_tests"
    }
  }
});
