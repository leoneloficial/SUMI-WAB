import { spawn } from "child_process";

const RESTART_DELAY_MS = 3000;
let updateInProgress = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteForShell(value) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function quoteForSh(value) {
  return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `El comando ${command} fallo con codigo ${code}.`
        )
      );
    });
  });
}

function buildRestartBootstrap(delayMs = RESTART_DELAY_MS) {
  const args = process.argv.slice(1);

  if (process.platform === "win32") {
    const waitSeconds = Math.max(1, Math.ceil(delayMs / 1000));
    const command = [
      `timeout /t ${waitSeconds} >nul`,
      `${quoteForShell(process.execPath)} ${args.map(quoteForShell).join(" ")}`,
    ].join(" && ");

    return {
      command: "cmd.exe",
      args: ["/c", command],
    };
  }

  const waitSeconds = Math.max(1, Math.ceil(delayMs / 1000));
  const command = [
    `sleep ${waitSeconds}`,
    `${quoteForSh(process.execPath)} ${args.map(quoteForSh).join(" ")}`,
  ].join("; ");

  return {
    command: "sh",
    args: ["-c", command],
  };
}

function scheduleRestart(delayMs = RESTART_DELAY_MS) {
  const managedByPm2 = Boolean(process.env.pm_id || process.env.PM2_HOME);

  if (!managedByPm2) {
    const bootstrap = buildRestartBootstrap(delayMs);
    const child = spawn(bootstrap.command, bootstrap.args, {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });

    child.unref();
  }

  setTimeout(() => {
    process.kill(process.pid, "SIGINT");
  }, managedByPm2 ? delayMs : 1200).unref?.();
}

function toLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function pickMainLine(result) {
  const lines = [...toLines(result?.stdout), ...toLines(result?.stderr)];
  return lines[0] || "Sin detalle extra.";
}

export default {
  name: "update",
  command: ["update"],
  category: "sistema",
  description: "Actualiza el bot con git pull y reinicia sin perder la sesion",

  run: async ({ sock, msg, from, args = [], esOwner }) => {
    const quoted = msg?.key ? { quoted: msg } : undefined;

    if (!esOwner) {
      return sock.sendMessage(
        from,
        {
          text: "Solo el owner puede usar .update.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    if (updateInProgress) {
      return sock.sendMessage(
        from,
        {
          text: "Ya hay una actualizacion en proceso. Espera a que termine.",
          ...global.channelInfo,
        },
        quoted
      );
    }

    updateInProgress = true;
    let restartScheduled = false;

    try {
      const forceRestart = ["force", "restart", "reboot"].includes(
        String(args[0] || "").toLowerCase()
      );

      await sock.sendMessage(
        from,
        {
          text:
            "*UPDATE BOT*\n\n" +
            "Buscando cambios en GitHub y preparando reinicio...",
          ...global.channelInfo,
        },
        quoted
      );

      const gitStatus = await runCommand("git", ["status", "--porcelain"]);
      if (gitStatus.stdout.trim()) {
        await sock.sendMessage(
          from,
          {
            text:
              "*UPDATE BLOQUEADO*\n\n" +
              "Hay cambios locales sin guardar en el repo.\n" +
              "Limpia esos cambios antes de usar .update.",
            ...global.channelInfo,
          },
          quoted
        );
        updateInProgress = false;
        return;
      }

      const currentBranch = (
        await runCommand("git", ["branch", "--show-current"])
      ).stdout.trim() || "main";
      const oldHead = (await runCommand("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
      const pullResult = await runCommand("git", [
        "pull",
        "--ff-only",
        "origin",
        currentBranch,
      ]);
      const newHead = (await runCommand("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
      const updated = oldHead !== newHead;

      let depsInstalled = false;
      let changedFiles = [];

      if (updated) {
        const diffResult = await runCommand("git", [
          "diff",
          "--name-only",
          oldHead,
          "HEAD",
        ]);
        changedFiles = toLines(diffResult.stdout);

        if (
          changedFiles.some((file) =>
            ["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(file)
          )
        ) {
          await sock.sendMessage(
            from,
            {
              text:
                "*UPDATE BOT*\n\n" +
                "Se detectaron cambios en dependencias. Instalando paquetes...",
              ...global.channelInfo,
            },
            quoted
          );

          await runCommand(getNpmCommand(), ["install"]);
          depsInstalled = true;
        }
      }

      if (!updated && !forceRestart) {
        await sock.sendMessage(
          from,
          {
            text:
              "*BOT ACTUALIZADO*\n\n" +
              `No habia cambios nuevos en GitHub.\n` +
              `Commit actual: *${newHead}*`,
            ...global.channelInfo,
          },
          quoted
        );
        updateInProgress = false;
        return;
      }

      const summary =
        updated
          ? `Commit: *${oldHead}* -> *${newHead}*`
          : `Commit actual: *${newHead}*`;
      const pullDetail = pickMainLine(pullResult);
      const changedSummary = changedFiles.length
        ? `Archivos: *${changedFiles.length}*`
        : "Archivos: *sin cambios nuevos*";
      const depsSummary = depsInstalled
        ? "Dependencias: *actualizadas*"
        : "Dependencias: *sin cambios*";

      await sock.sendMessage(
        from,
        {
          text:
            "*UPDATE OK*\n\n" +
            `${summary}\n` +
            `${changedSummary}\n` +
            `${depsSummary}\n` +
            `Git: ${pullDetail}\n\n` +
            "Reiniciando el bot en unos segundos.\n" +
            "La sesion de WhatsApp se conserva, aunque puede haber una reconexion breve.",
          ...global.channelInfo,
        },
        quoted
      );

      await delay(1500);
      restartScheduled = true;
      scheduleRestart(RESTART_DELAY_MS);
    } catch (error) {
      await sock.sendMessage(
        from,
        {
          text:
            "*ERROR UPDATE*\n\n" +
            `${error?.message || "No pude actualizar el bot."}`,
          ...global.channelInfo,
        },
        quoted
      );
      updateInProgress = false;
      return;
    } finally {
      if (!restartScheduled) {
        updateInProgress = false;
      }
    }
  },
};
