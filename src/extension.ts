import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceProvider, WorkspaceItem } from './WorkspaceProvider';
import { GitStatusProvider } from './GitStatusProvider';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    const pbiProvider = new WorkspaceProvider();
    const gitProvider = new GitStatusProvider();

    vscode.window.registerTreeDataProvider('pbiWorkspaces', pbiProvider);
    vscode.window.registerTreeDataProvider('pbiGitStatus', gitProvider);

    const gitStatusView = vscode.window.createTreeView('pbiGitStatus', {
        treeDataProvider: gitProvider
    });

    // Command triggered when clicking a Workspace in the first pane
    vscode.commands.registerCommand('pbiWorkspaces.selectWorkspace', (node: WorkspaceItem) => {
        // 1. Show the Git Status pane (via the 'when' clause in package.json)
        vscode.commands.executeCommand('setContext', 'pbiWorkspaceSelected', true);

        gitStatusView.title = `${node.label}`;
        
        // 2. Tell the second provider to load data for this ID
        gitProvider.refresh(node.workspaceId);
    });

    let refreshCommand = vscode.commands.registerCommand('fabricGitStatus.refreshGitStatus', () => {
        gitProvider.refresh();
    });

    context.subscriptions.push(refreshCommand);

    let workspaceRefreshCommand = vscode.commands.registerCommand('pbiWorkspaces.refreshWorkspaces', () => {
        pbiProvider.refresh();
    });

    context.subscriptions.push(workspaceRefreshCommand);

    vscode.commands.registerCommand('git-diff-4-fabric.checkoutHead', async (workspaceId: string, headHash: string) => {
        if (!headHash) {
            vscode.window.showErrorMessage("No HEAD hash found for this workspace.");
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to checkout HEAD (${headHash.substring(0, 7)})? This may overwrite local changes.`,
            "Yes", "No"
        );

        if (confirm === "Yes") {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Syncing Fabric Workspace to ${headHash.substring(0, 7)}...`,
                cancellable: false
            }, async () => {
                try {
                    // Get the current workspace folder path
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        throw new Error("No workspace folder open.");
                    }
                    const cwd = workspaceFolders[0].uri.fsPath;

                    // Run the actual git command
                    // Note: Use 'git checkout' or 'git reset --hard' depending on your goal
                    await execAsync(`git checkout ${headHash}`, { cwd });

                    vscode.window.showInformationMessage(`Successfully checked out ${headHash}`);

                    gitProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Git Error: ${error.message}`);
                }
            });
        }
    });

    const downloadCommand = vscode.commands.registerCommand('git-diff-4-fabric.download', async (selectedWsId, objectIdsWithChanges) => {
        try {
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: true }
            );

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fabric: Downloading Workspace Content",
                cancellable: false
            }, async (progress) => {

                // 1. Fetch Folders to build a lookup map
                progress.report({ message: "Fetching folder structure..." });
                const foldersResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/folders`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const foldersData: any = await foldersResponse.json();
                
                // Map: folderId -> displayName
                const folderMap: { [key: string]: string } = {};
                if (foldersData.value) {
                    foldersData.value.forEach((f: any) => {
                        folderMap[f.id] = f.displayName;
                    });
                }

                console.log(foldersData)

                // 2. Fetch ALL items
                progress.report({ message: "Listing all items..." });
                const itemsResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/items`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const itemsData: any = await itemsResponse.json();
                const allItems = itemsData.value || [];

                const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!rootPath) throw new Error("Open a folder in VS Code first.");

                for (const item of allItems) {
                    if(!objectIdsWithChanges.includes(item.id)) continue;
                    
                    progress.report({ message: `${item.displayName}...` });

                    // --- NEW LOGIC: Resolve Folder Name ---
                    let parentPath = rootPath;
                    if (item.folderId && folderMap[item.folderId]) {
                        // If folderId exists and is in our map, add it to the path
                        parentPath = path.join(rootPath, folderMap[item.folderId]);
                    }
                    // --------------------------------------

                    // Start the Get Definition job
                    let defResponse = await fetch(
                        `https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/items/${item.id}/getDefinition`,
                        { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } }
                    );

                    // Handle Long Running Operation (202 Accepted)
                    if (defResponse.status === 202) {
                        const monitorUrl = defResponse.headers.get('Location');
                        if (monitorUrl) {
                            let jobSucceeded = false;
                            while (!jobSucceeded) {
                                const poll = await fetch(monitorUrl, { headers: { Authorization: `Bearer ${session.accessToken}` } });
                                const jobData: any = await poll.json();
                                if (jobData.status === 'Succeeded') {
                                    jobSucceeded = true;
                                    defResponse = await fetch(`${monitorUrl}/result`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
                                } else if (jobData.status === 'Failed') {
                                    console.error(`Failed to export ${item.displayName}`);
                                    break; 
                                }
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }

                    if (defResponse.status !== 200) continue;

                    const finalResult: any = await defResponse.json();
                    const parts = finalResult.definition?.parts || [];

                    // 3. Create Item Folder inside the resolved parent path
                    const itemFolderName = `${item.displayName}.${item.type}`;
                    const itemFolderPath = path.join(parentPath, itemFolderName);
                    
                    for (const part of parts) {
                        if (!part.payload) continue;

                        const absoluteFilePath = path.join(itemFolderPath, part.path);
                        const directoryPath = path.dirname(absoluteFilePath);

                        if (!fs.existsSync(directoryPath)) {
                            fs.mkdirSync(directoryPath, { recursive: true });
                        }

                        const buffer = Buffer.from(part.payload, 'base64');
                        fs.writeFileSync(absoluteFilePath, buffer);
                    }
                }
                vscode.window.showInformationMessage(`Export complete!`);
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
        }
    });

    context.subscriptions.push(downloadCommand);

}

export function deactivate() {}
