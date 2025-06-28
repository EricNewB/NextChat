import tauriConfig from "../../src-tauri/tauri.conf.json";
import { DEFAULT_INPUT_TEMPLATE } from "../constant";

export const getBuildConfig = () => {
  if (typeof process === "undefined") {
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );
  }

  const buildMode = process.env.BUILD_MODE ?? "standalone";
  const isApp = !!process.env.BUILD_APP;
  const version = "v" + tauriConfig.package.version;

  const commitInfo = (() => {
    try {
      const childProcess = require("child_process");
      const commitDate: string = childProcess
        .execSync('git log -1 --format="%at000" --date=unix')
        .toString()
        .trim();
      const commitHash: string = childProcess
        .execSync('git log --pretty=format:"%H" -n 1')
        .toString()
        .trim();

      return { commitDate, commitHash };
    } catch (e) {
      console.error("[Build Config] No git or not from git repo.");
      return {
        commitDate: "unknown",
        commitHash: "unknown",
      };
    }
  })();

  const realtimeConfig = {
    enabled: !!process.env.REALTIME_API_KEY,
    provider: process.env.REALTIME_PROVIDER ?? "OpenAI",
    apiKey: process.env.REALTIME_API_KEY ?? "",
    model: process.env.REALTIME_MODEL ?? "gpt-4o-realtime-preview-2024-10-01",
    voice: process.env.REALTIME_VOICE ?? "alloy",
    temperature: parseFloat(process.env.REALTIME_TEMPERATURE ?? "0.9"),
    azure: {
      endpoint: process.env.REALTIME_AZURE_ENDPOINT,
      deployment: process.env.REALTIME_AZURE_DEPLOYMENT,
    },
  };

  return {
    version,
    ...commitInfo,
    buildMode,
    isApp,
    template: process.env.DEFAULT_INPUT_TEMPLATE ?? DEFAULT_INPUT_TEMPLATE,
    realtimeConfig,
  };
};

export type BuildConfig = ReturnType<typeof getBuildConfig>;
