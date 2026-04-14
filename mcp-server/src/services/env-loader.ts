import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(...directories: string[]) {
  const candidates = [
    ...directories.filter(Boolean),
    process.cwd()
  ];

  for (const directory of candidates) {
    const envPath = resolve(directory, ".env.local");
    if (!existsSync(envPath)) {
      continue;
    }

    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...valueParts] = trimmed.split("=");
      process.env[key] ??= valueParts.join("=");
    }

    return;
  }
}
