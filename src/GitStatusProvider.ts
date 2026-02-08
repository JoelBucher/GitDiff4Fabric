import * as vscode from 'vscode';
import { execSync } from 'child_process';

function changeToIcon(workspaceChange: string) {
    switch (workspaceChange) {
        case "Added":
            return "+"
        case "Modified":
            return "M"
        default:
            return "M"
    }
}

export class GitStatusProvider implements vscode.TreeDataProvider<GitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private activeWorkspaceId: string | undefined;
    private cachedChanges: any[] = [];

    /**
     * Refreshes the tree. 
     * If workspaceId is provided, it updates the target.
     * Otherwise, it just clears the cache and re-runs getChildren.
     */
    refresh(workspaceId?: string): void {
        if (workspaceId) {
            this.activeWorkspaceId = workspaceId;
        }
        this.cachedChanges = [];
        this._onDidChangeTreeData.fire();
    }

    private getLocalHead(): string | undefined {
        try {
            const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!rootPath) return undefined;
            return execSync('git rev-parse HEAD', { cwd: rootPath }).toString().trim();
        } catch (e) {
            return undefined;
        }
    }

    getTreeItem(element: GitItem): vscode.TreeItem { return element; }

    async getChildren(element?: GitItem): Promise<GitItem[]> {
        // If we don't have a workspace ID yet, show a helpful message
        if (!this.activeWorkspaceId) {
            return [new GitItem("No Fabric Workspace Selected", "info")];
        }

        if (element && element.contextValue === 'changes-parent') {
            return this.cachedChanges.map((c: any) => {
                const name = c.itemMetadata.displayName;
                const workspaceChange = c.itemMetadata.workspaceChange;
                const objectId = c.itemMetadata.itemIdentifier.objectId;

                return new GitItem(
                    `[${changeToIcon(workspaceChange)}] ${name}`,
                    'file-code',
                    objectId
                );
            });
        }

        const session = await vscode.authentication.getSession('microsoft',
            ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: false });

        if (!session) return [new GitItem("Please Sign In", "account")];

        try {
            const statusRes = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${this.activeWorkspaceId}/git/status`, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });

            if (statusRes.status === 404) return [new GitItem("Git not configured", "error")];

            const statusData: any = await statusRes.json();
            this.cachedChanges = statusData.changes || [];
            const workspaceHead = statusData["workspaceHead"];
            const localHead = this.getLocalHead();

            const items: GitItem[] = [];

            // 1. Changes at the top
            if (this.cachedChanges.length > 0) {
                const changesFolder = new GitItem(
                    `Changes (${this.cachedChanges.length})`,
                    'list-unordered',
                    undefined,
                    'changes-parent'
                );
                changesFolder.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                items.push(changesFolder);
            } else {
                items.push(new GitItem("Synced with Git", "arrow-swap", undefined, undefined, new vscode.ThemeColor('charts.green')));
            }

            // 2. Action Button at the bottom
            if (workspaceHead && localHead === workspaceHead) {
                const diffBtn = new GitItem("Show Git Diff", "arrow-swap", undefined, "button", new vscode.ThemeColor('charts.green'));
                diffBtn.command = { command: 'git-diff-4-fabric.showDiff', title: 'Show Git Diff' };
                items.push(diffBtn);
            } else {
                const checkoutBtn = new GitItem("Sync Local Git Repo", "git-branch-conflicts", undefined, "button", new vscode.ThemeColor('charts.blue'));
                checkoutBtn.command = {
                    command: 'git-diff-4-fabric.checkoutHead',
                    title: 'Checkout HEAD',
                    arguments: [this.activeWorkspaceId, workspaceHead]
                };
                items.push(checkoutBtn);
            }

            return items;
        } catch (err) {
            return [new GitItem("Failed to fetch status", "warning")];
        }
    }
}

class GitItem extends vscode.TreeItem {
    constructor(
        label: string,
        icon: string,
        public readonly objectId?: string,
        contextValue?: string,
        iconColor?: vscode.ThemeColor
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon, iconColor);
        this.contextValue = contextValue;
    }
}