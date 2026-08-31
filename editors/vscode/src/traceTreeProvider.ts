import * as vscode from 'vscode';
import { IncrementalTraceReader, TraceEntry } from './incrementalTraceReader';

interface TraceNode {
    type: 'session' | 'tool' | 'event';
    label: string;
    description?: string;
    tooltip?: string | vscode.MarkdownString;
    iconPath?: vscode.ThemeIcon;
    children?: TraceNode[];
    entry?: TraceEntry;
}

export class TraceTreeProvider implements vscode.TreeDataProvider<TraceNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TraceNode | undefined | void> = new vscode.EventEmitter<TraceNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TraceNode | undefined | void> = this._onDidChangeTreeData.event;

    private nodes: TraceNode[] = [];
    private showDeniedOnly = false;

    constructor(
        private traceReader: IncrementalTraceReader
    ) {}

    refresh(): void {
        this.traceReader.readNewEvents();
        this.loadTraces();
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.traceReader.clear();
        this.nodes = [];
        this._onDidChangeTreeData.fire();
    }

    toggleDeniedFilter(): void {
        this.showDeniedOnly = !this.showDeniedOnly;
        this.loadTraces();
        this._onDidChangeTreeData.fire();
        
        const status = this.showDeniedOnly ? 'showing denied only' : 'showing all';
        vscode.window.showInformationMessage(`Agent Runtime: ${status}`);
    }

    getTreeItem(element: TraceNode): vscode.TreeItem {
        const collapsibleState = element.children && element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(element.label, collapsibleState);
        
        if (element.description) {
            item.description = element.description;
        }
        if (element.tooltip) {
            item.tooltip = element.tooltip;
        }
        if (element.iconPath) {
            item.iconPath = element.iconPath;
        }

        return item;
    }

    getChildren(element?: TraceNode): Thenable<TraceNode[]> {
        if (!element) {
            return Promise.resolve(this.nodes);
        }
        return Promise.resolve(element.children || []);
    }

    private loadTraces() {
        let entries = this.traceReader.getEvents();

        if (this.showDeniedOnly) {
            entries = entries.filter(e => e.action === 'deny');
        }

        this.nodes = this.buildTree(entries);
    }

    private buildTree(entries: TraceEntry[]): TraceNode[] {
        const byDate = new Map<string, TraceEntry[]>();
        
        for (const entry of entries) {
            const date = entry.timestamp.slice(0, 10);
            if (!byDate.has(date)) {
                byDate.set(date, []);
            }
            byDate.get(date)!.push(entry);
        }

        const nodes: TraceNode[] = [];

        for (const [date, dateEntries] of byDate) {
            const sessionNode: TraceNode = {
                type: 'session',
                label: `${date}`,
                description: `${dateEntries.length} events`,
                children: this.buildToolNodes(dateEntries)
            };
            nodes.push(sessionNode);
        }

        return nodes.reverse();
    }

    private buildToolNodes(entries: TraceEntry[]): TraceNode[] {
        const nodes: TraceNode[] = [];

        for (const entry of entries) {
            const toolName = (entry.payload.toolName as string) || entry.event;
            const action = entry.action.toUpperCase();
            const time = entry.timestamp.slice(11, 23);
            
            let icon: vscode.ThemeIcon;
            if (entry.action === 'deny') {
                icon = new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'));
            } else if (entry.action === 'warn') {
                icon = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
            } else {
                icon = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            }

            let description = action;
            if (entry.payload.filePath) {
                const filePath = entry.payload.filePath as string;
                const shortPath = filePath.length > 30 ? '...' + filePath.slice(-27) : filePath;
                description += ` -> ${shortPath}`;
            } else if (entry.payload.input && typeof entry.payload.input === 'object') {
                const input = entry.payload.input as any;
                if (input.command) {
                    const cmd = input.command as string;
                    const shortCmd = cmd.length > 30 ? cmd.slice(0, 27) + '...' : cmd;
                    description += ` -> ${shortCmd}`;
                }
            }

            const toolNode: TraceNode = {
                type: 'tool',
                label: `${time} ${toolName}`,
                description,
                tooltip: this.buildTooltip(entry),
                iconPath: icon,
                entry,
                children: this.buildEventNodes(entry)
            };

            nodes.push(toolNode);
        }

        return nodes;
    }

    private buildEventNodes(entry: TraceEntry): TraceNode[] {
        const nodes: TraceNode[] = [];

        if (entry.feedback && entry.feedback.length > 0) {
            for (const msg of entry.feedback) {
                nodes.push({
                    type: 'event',
                    label: msg,
                    iconPath: new vscode.ThemeIcon('comment')
                });
            }
        }

        if (entry.payload) {
            const details: string[] = [];
            
            if (entry.payload.server) {
                details.push(`Server: ${entry.payload.server}`);
            }
            if (entry.payload.operation) {
                details.push(`Operation: ${entry.payload.operation}`);
            }
            if (entry.payload.toolName) {
                details.push(`Tool: ${entry.payload.toolName}`);
            }

            for (const detail of details) {
                nodes.push({
                    type: 'event',
                    label: detail,
                    iconPath: new vscode.ThemeIcon('info')
                });
            }
        }

        return nodes;
    }

    private buildTooltip(entry: TraceEntry): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${entry.event}**\n\n`);
        md.appendMarkdown(`**Time:** ${entry.timestamp}\n\n`);
        md.appendMarkdown(`**Source:** ${entry.source}\n\n`);
        md.appendMarkdown(`**Action:** ${entry.action}\n\n`);
        
        if (entry.feedback && entry.feedback.length > 0) {
            md.appendMarkdown(`**Feedback:**\n\n`);
            for (const msg of entry.feedback) {
                md.appendMarkdown(`- ${msg}\n`);
            }
        }

        return md;
    }
}