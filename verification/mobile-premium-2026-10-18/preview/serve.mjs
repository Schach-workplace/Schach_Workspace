// Usage: node verification/mobile-premium-2026-10-18/preview/serve.mjs
import { fileURLToPath } from "node:url";
import { createServer } from "../../../mobile/node_modules/vite/dist/node/index.js";
const root = fileURLToPath(new URL("./", import.meta.url));
const mobile = fileURLToPath(new URL("../../../mobile/", import.meta.url));
const local = (name) => fileURLToPath(new URL(name, import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
  },
  resolve: {
    alias: [
      {
        find: /^react-native$/,
        replacement: mobile + "node_modules/react-native-web/dist/index.js",
      },
      { find: /^react$/, replacement: mobile + "node_modules/react/index.js" },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: mobile + "node_modules/react/jsx-dev-runtime.js",
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: mobile + "node_modules/react/jsx-runtime.js",
      },
      {
        find: /^react-dom\/client$/,
        replacement: mobile + "node_modules/react-dom/client.js",
      },
      {
        find: /^react-native-safe-area-context$/,
        replacement:
          mobile +
          "node_modules/react-native-safe-area-context/lib/module/index.js",
      },
      { find: /^expo$/, replacement: local("./expo.ts") },
      { find: /^expo-crypto$/, replacement: local("./crypto.ts") },
      { find: /^expo-router$/, replacement: local("./router.tsx") },
    ],
    extensions: [
      ".web.tsx",
      ".tsx",
      ".web.ts",
      ".ts",
      ".web.js",
      ".js",
      ".json",
    ],
    dedupe: ["react", "react-dom"],
  },
  define: {
    __DEV__: false,
    "process.env.EXPO_PUBLIC_SERVER_URL": JSON.stringify(
      "https://fictional.example.invalid",
    ),
  },
  optimizeDeps: { exclude: ["react-native-safe-area-context"] },
  plugins: [
    {
      name: "fictional-only-workspace",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer?.includes("/mobile/src/") &&
          [
            "./Execution",
            "./DeadlinePicker",
            "./TaskCsv",
            "./FinanceDraftForm",
            "./IntelligenceLauncher",
            "./HistoricalReports",
            "./SavedReports",
            "./shareDocument",
            "./Media",
            "./Publication",
            "./LinkedWork",
            "./Structured",
            "./ChatControls",
          ].includes(source)
        )
          return local("./boundaries.tsx");

        if (
          importer?.includes("/react-native-safe-area-context/") &&
          ["./SafeAreaView", "./NativeSafeAreaProvider"].includes(source)
        )
          return (
            mobile +
            "node_modules/react-native-safe-area-context/lib/module/" +
            source.slice(2) +
            ".web.js"
          );
        if (
          importer?.includes("/mobile/src/") &&
          /^(\.\.\/|\.\/)+(Workspace|client)$/.test(source)
        )
          return local(
            source.endsWith("Workspace") ? "./workspace.tsx" : "./client.ts",
          );
      },
    },
  ],
});
await server.listen();
server.printUrls();
console.log("Owned preview PID", process.pid);
