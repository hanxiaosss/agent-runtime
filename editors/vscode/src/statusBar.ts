import * as vscode from 'vscode';
import { IncrementalTraceReader } from './incrementalTraceReader';

export class StatusBarController implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private updateInterval: NodeJS.Timeout | undefined;
    private timeWindowMinutes = 60; // Default: 1 hour

    constructor(
        private traceReader: IncrementalTraceReader
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'agentRuntime.showTraceView';
        this.statusBarItem.tooltip = 'Agent Runtime: Click to view trace details';
        this.statusBarItem.show();
        
        // Update every 5 seconds
        this.updateInterval = setInterval(() => this.update(), 5000);
        this.update();
    }

    private update(): void {
        const counts = this.traceReader.getCountsByAction(this.timeWindowMinutes);
        const total = counts.allow + counts.deny + counts.warn + counts.modify;
        
        if (total === 0) {
            this.statusBarItem.text = '$(shield) Agent Runtime';
            this.statusBarItem.tooltip = 'Agent Runtime: No events yet';
        } else {
            const allowIcon = counts.allow > 0 ? `${counts.allow}✓` : '';
            const denyIcon = counts.deny > 0 ? `${counts.deny}✗` : '';
            const warnIcon = counts.warn > 0 ? `${counts.warn}⚠` : '';
            
            const parts = [allowIcon, denyIcon, warnIcon].filter(p => p).join(' · ');
            this.statusBarItem.text = `$(shield) ${parts}`;
            
            const timeLabel = this.timeWindowMinutes >= 60 
                ? `${this.timeWindowMinutes / 60}h`
                : `${this.timeWindowMinutes}m`;
            
            this.statusBarItem.tooltip = `Agent Runtime: ${counts.allow} allowed, ${counts.deny} denied, ${counts.warn} warned (last ${timeLabel})`;
        }
    }

    setTimeWindow(minutes: number): void {
        this.timeWindowMinutes = minutes;
        this.update();
    }

    dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.statusBarItem.dispose();
    }
}