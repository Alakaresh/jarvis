import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const resolveLocalPath = (relativePath) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const optionalAliases = {};

const registerOptionalAlias = (moduleId, localPath) => {
  try {
    require.resolve(moduleId);
  } catch (error) {
    optionalAliases[moduleId] = localPath;
  }
};

registerOptionalAlias(
  "@picovoice/porcupine-web-en-worker",
  resolveLocalPath("./src/shims/picovoice-porcupine-web-en-worker.js"),
);

registerOptionalAlias(
  "@picovoice/web-voice-processor",
  resolveLocalPath("./src/shims/picovoice-web-voice-processor.js"),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: optionalAliases,
  },
});
