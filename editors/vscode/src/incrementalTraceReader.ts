import * as fs from 'fs';
import * as path from 'path';

export interface TraceEntry {
    timestamp: string;
    event: string;
    source: string;
    action: string;
    payload: Record<string, unknown>;
    feedback: string[];
}

interface TraceFileState {
    filePath: string;
    lastOffset: number;
    size: number;
}

export class IncrementalTraceReader {
    private fileStates: Map<string, TraceFileState> = new Map();
    private events: TraceEntry[] = [];
    private maxEvents: number;

    constructor(
        private tracePath: string,
        maxEvents: number = 1000
    ) {
        this.maxEvents = maxEvents;
    }

    /**
     * Read new events from trace files incrementally.
     * Only reads content added since last call.
     */
    readNewEvents(): TraceEntry[] {
        if (!fs.existsSync(this.tracePath)) {
            return this.events;
        }

        try {
            const files = fs.readdirSync(this.tracePath)
                .filter(f => f.endsWith('.jsonl'))
                .sort();

            let hasNewEvents = false;

            for (const file of files) {
                const filePath = path.join(this.tracePath, file);
                const stat = fs.statSync(filePath);
                const state = this.fileStates.get(filePath);

                if (!state) {
                    // New file - read from beginning
                    this.fileStates.set(filePath, {
                        filePath,
                        lastOffset: 0,
                        size: stat.size
                    });
                    const newEvents = this.readNewContent(filePath, 0, stat.size);
                    if (newEvents.length > 0) {
                        this.events.push(...newEvents);
                        hasNewEvents = true;
                    }
                } else if (stat.size > state.size) {
                    // File grew - read new content
                    const newEvents = this.readNewContent(filePath, state.size, stat.size);
                    if (newEvents.length > 0) {
                        this.events.push(...newEvents);
                        hasNewEvents = true;
                    }
                    state.size = stat.size;
                    state.lastOffset = stat.size;
                } else if (stat.size < state.size) {
                    // File was truncated/rotated - reset
                    this.fileStates.set(filePath, {
                        filePath,
                        lastOffset: 0,
                        size: stat.size
                    });
                    const newEvents = this.readNewContent(filePath, 0, stat.size);
                    if (newEvents.length > 0) {
                        this.events.push(...newEvents);
                        hasNewEvents = true;
                    }
                }
            }

            // Trim old events if exceeding max
            if (this.events.length > this.maxEvents) {
                this.events = this.events.slice(-this.maxEvents);
            }

            return this.events;
        } catch (error) {
            console.error('Failed to read traces:', error);
            return this.events;
        }
    }

    /**
     * Read new content from a file between start and end offsets.
     */
    private readNewContent(filePath: string, startOffset: number, endOffset: number): TraceEntry[] {
        const events: TraceEntry[] = [];

        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(endOffset - startOffset);
            fs.readSync(fd, buffer, 0, buffer.length, startOffset);
            fs.closeSync(fd);

            const content = buffer.toString('utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line) as TraceEntry;
                    events.push(entry);
                } catch {
                    // Skip malformed lines
                }
            }
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
        }

        return events;
    }

    /**
     * Get all events currently loaded.
     */
    getEvents(): TraceEntry[] {
        return this.events;
    }

    /**
     * Clear all loaded events and reset file states.
     */
    clear(): void {
        this.events = [];
        this.fileStates.clear();
    }

    /**
     * Get events within a time window.
     */
    getEventsInWindow(minutes: number): TraceEntry[] {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        return this.events.filter(e => new Date(e.timestamp) >= cutoff);
    }

    /**
     * Get event counts by action within a time window.
     */
    getCountsByAction(minutes: number): { allow: number; deny: number; warn: number; modify: number } {
        const events = this.getEventsInWindow(minutes);
        return {
            allow: events.filter(e => e.action === 'allow').length,
            deny: events.filter(e => e.action === 'deny').length,
            warn: events.filter(e => e.action === 'warn').length,
            modify: events.filter(e => e.action === 'modify').length
        };
    }
}