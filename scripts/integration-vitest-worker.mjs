import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const vitestArguments = [
  "vitest",
  "run",
  "tests/integration",
  "--no-file-parallelism",
  "--maxWorkers=1",
];
const workerFailureMessage = "Integration Vitest worker failed.";

let testProcess;
let interrupted = false;
let rejectInterruption;
const interruption = new Promise((_, reject) => {
  rejectInterruption = reject;
});

function interrupt() {
  if (interrupted) return;
  interrupted = true;
  if (testProcess?.exitCode === null && testProcess.signalCode === null) {
    testProcess.kill("SIGTERM");
  }
  rejectInterruption(new Error(workerFailureMessage));
}

process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

function receiveLock() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(workerFailureMessage));
    }, 10_000);
    const onDisconnect = () => {
      cleanup();
      reject(new Error(workerFailureMessage));
    };
    const onMessage = (message, handle) => {
      cleanup();
      if (
        !message
        || typeof message !== "object"
        || Array.isArray(message)
        || Object.keys(message).length !== 1
        || message.type !== "integration-run-lock"
        || !handle
        || typeof handle.close !== "function"
        || typeof handle.ref !== "function"
      ) {
        reject(new Error(workerFailureMessage));
        return;
      }
      resolve(handle);
    };
    function cleanup() {
      clearTimeout(timeout);
      process.off("disconnect", onDisconnect);
      process.off("message", onMessage);
    }

    process.once("disconnect", onDisconnect);
    process.once("message", onMessage);
  });
}

function acknowledgeLock() {
  return new Promise((resolve, reject) => {
    if (!process.connected || typeof process.send !== "function") {
      reject(new Error(workerFailureMessage));
      return;
    }
    process.send({ type: "integration-run-lock-held" }, (error) => {
      if (error) {
        reject(new Error(workerFailureMessage));
        return;
      }
      resolve();
    });
  });
}

function runVitest(canStart) {
  return new Promise((resolve) => {
    if (!canStart()) {
      resolve(1);
      return;
    }
    try {
      testProcess = spawn(command, vitestArguments, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      });
    } catch {
      resolve(1);
      return;
    }

    let settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    testProcess.once("error", () => settle(1));
    testProcess.once("exit", (code, signal) => {
      settle(signal ? 1 : (code ?? 1));
    });
    if (interrupted && testProcess.exitCode === null) {
      testProcess.kill("SIGTERM");
    }
  });
}

function closeLock(listener) {
  return new Promise((resolve) => {
    try {
      listener.close((error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}

async function main() {
  const listener = await Promise.race([receiveLock(), interruption]);
  let listenerFailed = false;
  listener.on("connection", (socket) => socket.destroy());
  listener.on("error", () => {
    listenerFailed = true;
    if (testProcess?.exitCode === null && testProcess.signalCode === null) {
      testProcess.kill("SIGTERM");
    }
  });
  listener.ref();

  let exitCode = 1;
  try {
    await Promise.race([acknowledgeLock(), interruption]);
    exitCode = await runVitest(() => !listenerFailed && !interrupted);
  } finally {
    const closed = await closeLock(listener);
    if (!closed || listenerFailed || interrupted) exitCode = 1;
  }
  return exitCode;
}

try {
  process.exitCode = await main();
} catch {
  console.error(workerFailureMessage);
  process.exitCode = 1;
} finally {
  if (process.connected) {
    try {
      process.disconnect();
    } catch {
      process.exitCode = 1;
    }
  }
}
