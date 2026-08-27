import * as vscode from 'vscode';
import { TraceTreeProvider } from './traceTreeProvider';
import { TraceWatcher } from './traceWatcher';

let treeProvider: TraceTreeProvider;
let traceWatcher: TraceWatcher;

export function activate(context: vscode.ExtensionContext) {
    console.log('Agent Runtime Trace extension activated');

    // Get configuration
    const config = vscode.workspace.getConfiguration('agentRuntime');
    const traceDir = config.get<string>('traceDir', '.harness/traces');
    const autoRefresh = config.get<boolean>('autoRefresh', true);
    const maxEntries = config.get<number>('maxEntries', 100);

    // Resolve trace directory path
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Agent Runtime: No workspace folder open');
        return;
    }

    const tracePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), traceDir).fsPath;

    // Create tree provider
    treeProvider = new TraceTreeProvider(tracePath, maxEntries);
    
    const treeView = vscode.window.createTreeView('agentRuntime.traceView', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // Create file watcher
    if (autoRefresh) {
        traceWatcher = new TraceWatcher(tracePath, () => {
            treeProvider.refresh();
        });
        context.subscriptions.push(traceWatcher);
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.refresh', () => {
            treeProvider.refresh();
            vscode.window.showInformationMessage('Agent Runtime: Trace refreshed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.clear', () => {
            treeProvider.clear();
            vscode.window.showInformationMessage('Agent Runtime: Trace cleared');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentRuntime.filterDenied', () => {
            treeProvider.toggleDeniedFilter();
        })
    );

    context.subscriptions.push(treeView);

    // Initial load
    treeProvider.refresh();

    vscode.window.showInformationMessage('Agent Runtime: Trace view initialized');
}

export function deactivate() {
    if (traceWatcher) {
        traceWatcher.dispose();
    }
}
