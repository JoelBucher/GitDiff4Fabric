import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

interface WorkspacePick extends vscode.QuickPickItem {
    id: string;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'fabric-auth-demo.login',
        async () => {
            try {
                // Step 1: Get Microsoft session
                const session = await vscode.authentication.getSession(
                    'microsoft',
                    ['https://analysis.windows.net/powerbi/api/.default'],
                    { createIfNone: true }
                );

                if (!session) {
                    vscode.window.showErrorMessage('Login failed.');
                    return;
                }

                const token = session.accessToken;

                // Step 2: Call Fabric (Power BI) API
                const response = await fetch(
                    'https://api.powerbi.com/v1.0/myorg/groups',
                    {
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    }
                );

                if (!response.ok) {
                    const text = await response.text();
                    vscode.window.showErrorMessage(
                        `API error: ${response.status} ${text}`
                    );
                    return;
                }

                const data = await response.json();

                // Step 3: Show result
                const workspaceCount = data.value?.length ?? 0;

                vscode.window.showInformationMessage(
                    `Logged in as ${session.account.label}. Found ${workspaceCount} workspaces.`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(
                    `Error: ${err.message || err}`
                );
            }
        }
    );

    context.subscriptions.push(disposable);

    const downloadCommand = vscode.commands.registerCommand('fabric-auth-demo.downloadNotebooks', async () => {
        try {
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: true }
            );

            // 1. Fetch Workspaces
            const wsResponse = await fetch('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const wsData: any = await wsResponse.json();
            
            interface WorkspacePick extends vscode.QuickPickItem { id: string; }
            const selectedWs = await vscode.window.showQuickPick(
                wsData.value.map((ws: any) => ({ label: ws.name, description: ws.id, id: ws.id })),
                { placeHolder: 'Select a workspace to download all items' }
            ) as WorkspacePick | undefined;

            if (!selectedWs) return;

            // Fetch Git Status to only download Items with changes
            const itemIdsWithChanges = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Checking Fabric Git Status...",
                cancellable: false
            }, async (progress) => {

                // 2. Fetch both Git Status AND the Full Item List in parallel
                // We fetch the item list so we can map IDs to real Names
                const [statusRes, itemsRes] = await Promise.all([
                    fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/git/status`, {
                        headers: { Authorization: `Bearer ${session.accessToken}` }
                    }),
                    fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items`, {
                        headers: { Authorization: `Bearer ${session.accessToken}` }
                    })
                ]);

                if (statusRes.status === 404) {
                    throw new Error("Git is not configured for this workspace.");
                }

                const statusData: any = await statusRes.json();                
                const changes = statusData.changes || [];

                if (changes.length === 0) {
                    vscode.window.showInformationMessage("Workspace is perfectly synced with Git!");
                    return;
                }

                console.log(changes)

                const objectIds = changes.map((c: any) => c["itemMetadata"]["itemIdentifier"]["objectId"])
                console.log(objectIds)

                return objectIds
            });

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fabric: Downloading Workspace Content",
                cancellable: false
            }, async (progress) => {

                // 2. Fetch ALL items (Notebooks, Reports, etc.)
                progress.report({ message: "Listing all items..." });
                const itemsResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const itemsData: any = await itemsResponse.json();
                const allItems = itemsData.value || [];

                const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!rootPath) throw new Error("Open a folder in VS Code first.");

                for (const item of allItems) {
                    if(!itemIdsWithChanges.includes(item.id)) continue;

                    console.log(item)
                    progress.report({ message: `Processing ${item.displayName}...` });

                    // Start the Get Definition job
                    let defResponse = await fetch(
                        `https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items/${item.id}/getDefinition`,
                        { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } }
                    );

                    // Handle Long Running Operation
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

                    // 3. Create Item Folder: "MyNotebook.Notebook" or "MyReport.Report"
                    const itemFolderName = `${item.displayName}.${item.type}`;
                    const itemFolderPath = path.join(rootPath, itemFolderName);
                    
                    for (const part of parts) {
                        if (!part.payload) continue;

                        // 4. Handle Subfolders within the item (e.g., "metadata/content.json")
                        const absoluteFilePath = path.join(itemFolderPath, part.path);
                        const directoryPath = path.dirname(absoluteFilePath);

                        // Ensure the sub-directories exist
                        if (!fs.existsSync(directoryPath)) {
                            fs.mkdirSync(directoryPath, { recursive: true });
                        }

                        // Decode and Write
                        const buffer = Buffer.from(part.payload, 'base64');
                        fs.writeFileSync(absoluteFilePath, buffer);
                    }
                }
                vscode.window.showInformationMessage(`Export complete! Check the 'fabric_export' folder.`);
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
        }
    });

    context.subscriptions.push(downloadCommand);


    const logoutCommand = vscode.commands.registerCommand('fabric-auth-demo.logout', async () => {
        try {
            // 1. Find the existing session for the 'microsoft' provider
            // We set createIfNone to false because we only want to find existing ones, not login
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: false }
            );

            if (session) {
                // 2. Remove the session
                // This clears the token from the VS Code secret store for your extension
                await (vscode.authentication as any).getSession('microsoft', 
                    ['https://analysis.windows.net/powerbi/api/.default'], 
                    { clearSession: true }
                );
                
                vscode.window.showInformationMessage(`Logged out of ${session.account.label} successfully.`);
            } else {
                vscode.window.showInformationMessage("You are not currently logged in.");
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Logout failed: ${err.message}`);
        }
    });

    context.subscriptions.push(logoutCommand);

}

export function deactivate() {}
