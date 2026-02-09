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
    const workspaceProvider = new WorkspaceProvider();
    const gitProvider = new GitStatusProvider();

    vscode.window.registerTreeDataProvider('workspaces', workspaceProvider);
    vscode.window.registerTreeDataProvider('workspaceGitStatus', gitProvider);

    const gitStatusView = vscode.window.createTreeView('workspaceGitStatus', {
        treeDataProvider: gitProvider
    });

    // Command triggered when clicking a Workspace in the first pane
    vscode.commands.registerCommand('git-diff-4-fabric.selectWorkspace', (node: WorkspaceItem) => {
        // 1. Show the Git Status pane (via the 'when' clause in package.json)
        vscode.commands.executeCommand('setContext', 'workspaceselected', true);

        gitStatusView.title = `${node.label}`;
        
        // 2. Tell the second provider to load data for this ID
        gitProvider.refresh(node.workspaceId);
    });

    let refreshCommand = vscode.commands.registerCommand('git-diff-4-fabric.refreshGitStatus', () => {
        gitProvider.refresh();
    });

    context.subscriptions.push(refreshCommand);

    let workspaceRefreshCommand = vscode.commands.registerCommand('git-diff-4-fabric.refreshWorkspaces', () => {
        workspaceProvider.refresh();
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
                title: "Fabric: Syncing Workspace",
                cancellable: false
            }, async (progress) => {

                // 1. Fetch Folder Hierarchy
                progress.report({ message: "Mapping folder structure..." });
                const foldersResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/folders`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const foldersData: any = await foldersResponse.json();
                
                // Build a metadata map: folderId -> { name, parentId }
                const folderMetadata: { [key: string]: { name: string, parentId?: string } } = {};
                if (foldersData.value) {
                    foldersData.value.forEach((f: any) => {
                        folderMetadata[f.id] = { 
                            name: f.displayName, 
                            parentId: f.parentFolderId 
                        };
                    });
                }

                /**
                 * Recursive helper to resolve the full path from a folderId
                 */
                const getFullFolderPath = (folderId: string): string => {
                    const folder = folderMetadata[folderId];
                    if (!folder) return "";
                    
                    // If this folder has a parent, resolve the parent's path first
                    if (folder.parentId && folderMetadata[folder.parentId]) {
                        return path.join(getFullFolderPath(folder.parentId), folder.name);
                    }
                    return folder.name;
                };

                // 2. Fetch Workspace Items
                progress.report({ message: "Fetching item list..." });
                const itemsResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/items`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const itemsData: any = await itemsResponse.json();
                const allItems = itemsData.value || [];

                const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!rootPath) throw new Error("Please open a local folder in VS Code first.");

                // 3. Process each item that has changes
                for (const item of allItems) {
                    if(!objectIdsWithChanges.includes(item.id)) continue;
                    
                    progress.report({ message: `Downloading ${item.displayName}...` });

                    // Resolve the specific directory for this item
                    let itemParentDir = rootPath;
                    if (item.folderId) {
                        const relativeHierarchy = getFullFolderPath(item.folderId);
                        itemParentDir = path.join(rootPath, relativeHierarchy);
                    }

                    // Start the Get Definition job (POST request)
                    let defResponse = await fetch(
                        `https://api.fabric.microsoft.com/v1/workspaces/${selectedWsId}/items/${item.id}/getDefinition`,
                        { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } }
                    );

                    // Handle Long Running Operation (Status 202)
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
                                    throw new Error(`Fabric job failed for item: ${item.displayName}`);
                                } else {
                                    // Wait 2 seconds before polling again
                                    await new Promise(r => setTimeout(r, 2000));
                                }
                            }
                        }
                    }

                    if (defResponse.status !== 200) {
                        console.error(`Skipping ${item.displayName}: API returned status ${defResponse.status}`);
                        continue;
                    }

                    const finalResult: any = await defResponse.json();
                    const parts = finalResult.definition?.parts || [];

                    // 4. Write parts to the recursive directory structure
                    // Format: [Root]/[Folders...]/[ItemName].[ItemType]/[InternalPath]
                    const itemFolderName = `${item.displayName}.${item.type}`;
                    const itemFolderPath = path.join(itemParentDir, itemFolderName);
                    
                    for (const part of parts) {
                        if (!part.payload) continue;

                        const absoluteFilePath = path.join(itemFolderPath, part.path);
                        const directoryPath = path.dirname(absoluteFilePath);

                        // Recursively create directories for the path
                        if (!fs.existsSync(directoryPath)) {
                            fs.mkdirSync(directoryPath, { recursive: true });
                        }

                        // Decode Base64 and save
                        const buffer = Buffer.from(part.payload, 'base64');
                        fs.writeFileSync(absoluteFilePath, buffer);
                    }
                }
                vscode.window.showInformationMessage(`Successfully synced ${objectIdsWithChanges.length} items to your workspace.`);
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Fabric Download Error: ${err.message}`);
        }
    });

    context.subscriptions.push(downloadCommand);

}

export function deactivate() {}
