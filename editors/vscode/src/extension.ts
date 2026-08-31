import * as vscode from 'vscode';
import * as path from 'path';
import { IncrementalTraceReader } from './incrementalTraceReader';
import { TraceTreeProvider } from './traceTreeProvider';
import { PolicyTreeProvider } from './policyTreeProvider';
import { StatusBarController } from './statusBar';
import * as fs from 'fs';

let traceReader: IncrementalTraceReader;
let traceTreeProvider: TraceTreeProvider;
let policyTreeProvider: PolicyTreeProvider;
let statusBar: StatusBarController;
let traceWatcher: fs.FSWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Agent Runtime extension activated');

    // Get configuration
    const config = vscode.workspace.getConfiguration('agentRuntime');
    const traceDir = config.get<string>('traceDir', '.harness/traces');
    const autoRefresh = config.get<boolean>('autoRefresh', true);
    const maxEntries = config.get<number>('maxEntries', 1000);

    // Resolve workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Agent Runtime: No workspace folder open');
        return;
    }

    // Check for .harness directory
    const harnessDir = path.join(workspaceRoot, '.harness');
    if (!fs.existsSync(harnessDir)) {
        vscode.window.showWarningMessage('Agent Runtime: No .harness/ directory found. Run "hannah init" first.');
        return;
    }

    const tracePath = path.join(workspaceRoot, traceDir);

    // Create incremental trace reader
    traceReader = new IncrementalTraceReader(tracePath, maxEntries);

    // Create trace tree provider
    traceTreeProvider = new TraceTreeProvider(traceReader);
    const traceTreeView = vscode.window.createTreeView('agentRuntime.traceView', {
        treeDataProvider: traceTreeProvider,
        showCollapseAll: true
    });

    // Create policy tree provider
    policyTreeProvider = new PolicyTreeProvider(harnessDir);
    const policyTreeView = vscode.window.createTreeView('agentRuntime.policyView', {
        treeDataProvider: policyTreeProvider,
        showCollapseAll: true
    });

    // Create status bar
    statusBar = new StatusBarController(traceReader);

    // Setup file watcher for auto-refresh
    if (autoRefresh) {
        setupFileWatcher(tracePath, () => {
            traceTreeProvider.refresh();
        });
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.refresh', () => {
            traceTreeProvider.refresh();
            policyTreeProvider.refresh();
            vscode.window.showInformationMessage('Agent Runtime: Refreshed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.clear', () => {
            traceTreeProvider.clear();
            vscode.window.showInformationMessage('Agent Runtime: Trace cleared');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.filterDenied', () => {
            traceTreeProvider.toggleDeniedFilter();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.showTraceView', () => {
            vscode.commands.executeCommand('agentRuntime.traceView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.showPolicyView', () => {
            vscode.commands.executeCommand('agentRuntime.policyView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.openPolicyFile', (filePath: string) => {
            vscode.workspace.openTextDocument(filePath).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.toggleRuleEnabled', async (filePath: string, ruleName: string) => {
            await policyTreeProvider.toggleRuleEnabled(filePath, ruleName);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.timeWindow5m', () => {
            statusBar.setTimeWindow(5);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.timeWindow1h', () => {
            statusBar.setTimeWindow(60);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.timeWindowToday', () => {
            statusBar.setTimeWindow(24 * 60);
        })
    );

    context.subscriptions.push(traceTreeView, policyTreeView, statusBar);

    // Initial load
    traceTreeProvider.refresh();
    policyTreeProvider.refresh();

    vscode.window.showInformationMessage('Agent Runtime: Governance panel initialized');
}

function setupFileWatcher(tracePath: string, onChange: () => void) {
    if (!fs.existsSync(tracePath)) {
        // Watch parent directory
        const parentDir = path.dirname(tracePath);
        if (fs.existsSync(parentDir)) {
            traceWatcher = fs.watch(parentDir, (eventType, filename) => {
                if (filename && filename.includes('traces')) {
                    onChange();
                }
            });
        }
        return;
    }

    try {
        traceWatcher = fs.watch(tracePath, (eventType, filename) => {
            if (filename && filename.endsWith('.jsonl')) {
                onChange();
            }
        });
    } catch (error) {
        console.error('Failed to watch trace directory:', error);
    }
}

export function deactivate() {
    if (traceWatcher) {
        traceWatcher.close();
    }
}