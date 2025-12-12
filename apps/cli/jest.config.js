export default {
  preset: "ts-jest/presets/default-esm",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  setupFiles: ["dotenv/config"],
  passWithNoTests: true,
  testTimeout: 20_000,
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/tests/**/*.test.ts"],
};
