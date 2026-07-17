#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const source = new URL("../src/index.ts", import.meta.url)
const runner = fileURLToPath(import.meta.url)
const child = spawn(process.execPath, ["--experimental-strip-types", source.pathname, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    SPECTA_CLI_RUNNER: process.env.SPECTA_CLI_RUNNER ?? JSON.stringify(process.execPath) + " " + JSON.stringify(runner),
  },
})

child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
