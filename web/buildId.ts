import type { Plugin } from "vite";

/**
 * One id per build. It is compiled into the bundle (__BUILD_ID__) and published as /version.json,
 * so a page can tell that it is running an outdated bundle (kill-switch in src/lib/swUpdate.ts).
 * The web app and the API deploy separately, so the web build carries its own id instead of
 * asking /api/version.
 */
export const BUILD_ID = process.env.BUILD_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function versionFilePlugin(buildId: string = BUILD_ID): Plugin {
  return {
    name: "fluesterlos-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) + "\n" });
    },
  };
}
