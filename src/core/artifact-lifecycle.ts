/**
 * Artifact Lifecycle Manager
 *
 * Manages the lifecycle of different artifacts in the .harness directory.
 * Handles archiving and clearing of commit-scoped artifacts.
 */

import * as fs from "fs";
import * as path from "path";

export interface LifecycleConfig {
  commitScoped: string[];
  archive: {
    enabled: boolean;
    dir: string;
    format?: string;
  };
}

export interface ArchiveMetadata {
  commitHash?: string;
  commitMessage?: string;
  author?: string;
  archivedAt: string;
  eventCount: number;
  sessionCount: number;
}

export class ArtifactLifecycleManager {
  private harnessDir: string;

  constructor(harnessDir: string = ".harness") {
    this.harnessDir = harnessDir;
  }

  /**
   * Archive and clear commit-scoped artifacts
   */
  async archiveAndClear(
    config: LifecycleConfig,
    commitInfo?: { hash: string; message: string; author: string },
  ): Promise<{ archived: boolean; clearedFiles: string[] }> {
    const result = { archived: false, clearedFiles: [] as string[] };

    if (!config.commitScoped || config.commitScoped.length === 0) {
      return result;
    }

    // Archive first if enabled
    if (config.archive?.enabled) {
      await this.createArchive(config, commitInfo);
      result.archived = true;
    }

    // Clear commit-scoped artifacts
    for (const artifact of config.commitScoped) {
      const cleared = await this.clearArtifact(artifact);
      result.clearedFiles.push(...cleared);
    }

    return result;
  }

  /**
   * Create an archive of current artifacts
   */
  private async createArchive(
    config: LifecycleConfig,
    commitInfo?: { hash: string; message: string; author: string },
  ): Promise<void> {
    const archiveDir = path.join(
      this.harnessDir,
      config.archive.dir || "archive",
    );

    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const commitHash = commitInfo?.hash || "unknown";
    const archiveFile = path.join(
      archiveDir,
      `commit-${commitHash}-${timestamp}.jsonl`,
    );

    // Collect all artifacts to archive
    const allEntries: any[] = [];
    let eventCount = 0;
    let sessionCount = 0;

    // Archive traces
    const tracesDir = path.join(this.harnessDir, "traces");
    if (fs.existsSync(tracesDir)) {
      const traceFiles = fs
        .readdirSync(tracesDir)
        .filter((f) => f.endsWith(".jsonl"));
      for (const file of traceFiles) {
        const content = fs.readFileSync(path.join(tracesDir, file), "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            allEntries.push(JSON.parse(line));
            eventCount++;
          } catch {}
        }
      }
    }

    // Archive sessions
    const sessionsDir = path.join(this.harnessDir, "sessions");
    if (fs.existsSync(sessionsDir)) {
      const sessionFiles = fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".json"));
      sessionCount = sessionFiles.length;
      for (const file of sessionFiles) {
        try {
          const content = fs.readFileSync(
            path.join(sessionsDir, file),
            "utf-8",
          );
          const session = JSON.parse(content);
          allEntries.push({
            _type: "session",
            ...session,
          });
        } catch {}
      }
    }

    // Archive hook logs
    const logsDir = path.join(this.harnessDir, "hooks", "logs");
    if (fs.existsSync(logsDir)) {
      const logFiles = fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith(".jsonl"));
      for (const file of logFiles) {
        const content = fs.readFileSync(path.join(logsDir, file), "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            allEntries.push(JSON.parse(line));
          } catch {}
        }
      }
    }

    // Write archive with metadata header
    const metadata: ArchiveMetadata = {
      commitHash: commitInfo?.hash,
      commitMessage: commitInfo?.message,
      author: commitInfo?.author,
      archivedAt: new Date().toISOString(),
      eventCount,
      sessionCount,
    };

    const archiveContent =
      JSON.stringify({ _archive: metadata }) +
      "\n" +
      allEntries.map((e) => JSON.stringify(e)).join("\n");

    fs.writeFileSync(archiveFile, archiveContent, "utf-8");
  }

  /**
   * Clear a specific artifact type
   */
  private async clearArtifact(artifact: string): Promise<string[]> {
    const cleared: string[] = [];

    switch (artifact) {
      case "traces": {
        const tracesDir = path.join(this.harnessDir, "traces");
        if (fs.existsSync(tracesDir)) {
          const files = fs
            .readdirSync(tracesDir)
            .filter((f) => f.endsWith(".jsonl"));
          for (const file of files) {
            fs.unlinkSync(path.join(tracesDir, file));
            cleared.push(`traces/${file}`);
          }
        }
        break;
      }

      case "sessions": {
        const sessionsDir = path.join(this.harnessDir, "sessions");
        if (fs.existsSync(sessionsDir)) {
          const files = fs
            .readdirSync(sessionsDir)
            .filter((f) => f.endsWith(".json"));
          for (const file of files) {
            fs.unlinkSync(path.join(sessionsDir, file));
            cleared.push(`sessions/${file}`);
          }
        }
        break;
      }

      case "hook-logs": {
        const logsDir = path.join(this.harnessDir, "hooks", "logs");
        if (fs.existsSync(logsDir)) {
          const files = fs
            .readdirSync(logsDir)
            .filter((f) => f.endsWith(".jsonl"));
          for (const file of files) {
            fs.unlinkSync(path.join(logsDir, file));
            cleared.push(`hooks/logs/${file}`);
          }
        }
        break;
      }
    }

    return cleared;
  }

  /**
   * Get archive statistics
   */
  getArchiveStats(archiveDir?: string): { count: number; totalSize: number } {
    const dir = path.join(this.harnessDir, archiveDir || "archive");

    if (!fs.existsSync(dir)) {
      return { count: 0, totalSize: 0 };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    let totalSize = 0;

    for (const file of files) {
      const stat = fs.statSync(path.join(dir, file));
      totalSize += stat.size;
    }

    return { count: files.length, totalSize };
  }

  /**
   * List all archives
   */
  listArchives(archiveDir?: string): Array<{
    filename: string;
    size: number;
    createdAt: Date;
    metadata?: ArchiveMetadata;
  }> {
    const dir = path.join(this.harnessDir, archiveDir || "archive");

    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    const archives: Array<{
      filename: string;
      size: number;
      createdAt: Date;
      metadata?: ArchiveMetadata;
    }> = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      // Try to read metadata from first line
      let metadata: ArchiveMetadata | undefined;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const firstLine = content.split("\n")[0];
        const parsed = JSON.parse(firstLine);
        if (parsed._archive) {
          metadata = parsed._archive;
        }
      } catch {}

      archives.push({
        filename: file,
        size: stat.size,
        createdAt: stat.birthtime,
        metadata,
      });
    }

    return archives.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
}
