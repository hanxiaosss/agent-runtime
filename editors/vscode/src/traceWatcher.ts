import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class TraceWatcher implements vscode.Disposable {
    private watcher: fs.FSWatcher | undefined;
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(
        private tracePath: string,
        private onChange: () => void
    ) {
        this.startWatching();
    }

    private startWatching() {
        if (!fs.existsSync(this.tracePath)) {
            // Directory doesn't exist yet, watch parent
            const parentDir = path.dirname(this.tracePath);
            if (fs.existsSync(parentDir)) {
                this.watcher = fs.watch(parentDir, (eventType, filename) => {
                    if (filename && filename.includes('traces')) {
                        this.handleChange();
                    }
                });
            }
            return;
        }

        try {
            this.watcher = fs.watch(this.tracePath, (eventType, filename) => {
                if (filename && filename.endsWith('.jsonl')) {
                    this.handleChange();
                }
            });
        } catch (error) {
            console.error('Failed to watch trace directory:', error);
        }
    }

    private handleChange() {
        // Debounce rapid changes
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.onChange();
        }, 300);
    }

    dispose() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        if (this.watcher) {
            this.watcher.close();
        }
    }
}
