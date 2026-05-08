import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface PushResult {
  success: boolean;
  commitHash?: string;
  message: string;
  filesChanged?: string[];
}

export function autoPush(
  message: string,
  files?: string[]
): PushResult {
  const repoPath = path.resolve(__dirname, "../../..");

  try {
    if (files && files.length > 0) {
      execSync(`git add ${files.map((f) => `"${f}"`).join(" ")}`, {
        cwd: repoPath,
        stdio: "pipe",
      });
    } else {
      execSync("git add -A", { cwd: repoPath, stdio: "pipe" });
    }

    const diff = execSync("git diff --cached --name-only", {
      cwd: repoPath,
      encoding: "utf-8",
    });

    const filesChanged = diff
      .trim()
      .split("\n")
      .filter(Boolean);

    if (filesChanged.length === 0) {
      return { success: true, message: "Nothing to commit." };
    }

    const commitHash = execSync(
      `git commit -m "${message.replace(/"/g, '\\"')}"`,
      { cwd: repoPath, encoding: "utf-8" }
    );

    execSync("git push", { cwd: repoPath, stdio: "pipe" });

    return {
      success: true,
      commitHash: commitHash.trim().split(/\s+/).pop(),
      message: `Pushed ${filesChanged.length} file(s): ${message}`,
      filesChanged,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Push failed: ${err.message}`,
    };
  }
}