import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Local Metro only: no EAS build, Apple login or paid account is needed.
const mobile = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(
  new URL("../node_modules/expo/bin/cli", import.meta.url),
);
const child = spawn(
  process.execPath,
  // Expo defaults to LAN; leave host overrides mutually exclusive (for example
  // --offline and --localhost cannot be combined with an explicit --lan).
  [cli, "start", "--go", ...process.argv.slice(2)],
  {
    cwd: mobile,
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_SERVER_URL:
        process.env.EXPO_PUBLIC_SERVER_URL ||
        "https://work.schachengineers.com",
    },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
