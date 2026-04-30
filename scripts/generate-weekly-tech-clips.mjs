// Compatibility wrapper. The generator is implemented with DeepAgents in Python.
import { spawn } from "node:child_process"

const python = process.env.PYTHON ?? "python3"
const child = spawn(python, ["scripts/generate-weekly-tech-clips.py"], {
  stdio: "inherit",
  env: process.env,
})

child.on("error", error => {
  console.error(error)
  process.exit(1)
})

child.on("exit", code => {
  process.exit(code ?? 1)
})
