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
            // 1. Get Session
            const session = await vscode.authentication.getSession('microsoft', 
                ['https://analysis.windows.net/powerbi/api/.default'], 
                { createIfNone: true }
            );

            // 2. Fetch Workspaces (Power BI API)
            const wsResponse = await fetch('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const wsData: any = await wsResponse.json();
            const workspaces = wsData.value || [];

            interface WorkspacePick extends vscode.QuickPickItem { id: string; }

            const selectedWs = await vscode.window.showQuickPick(
                workspaces.map((ws: any) => ({ 
                    label: ws.name, 
                    description: ws.id,
                    id: ws.id 
                })),
                { placeHolder: 'Select a workspace' }
            ) as WorkspacePick | undefined;

            if (!selectedWs) return;

            // 3. Start a Progress Notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fabric Download",
                cancellable: false
            }, async (progress) => {

                progress.report({ message: "Fetching notebook list..." });

                // 4. Fetch Items (Fabric API)
                const itemsResponse = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items`, {
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                const itemsData: any = await itemsResponse.json();
                const notebooks = (itemsData.value || []).filter((i: any) => i.type === 'Notebook');

                if (notebooks.length === 0) {
                    vscode.window.showInformationMessage('No notebooks found in this workspace.');
                    return;
                }

                // 5. Setup Local Folder
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage('Please open a folder in VS Code first.');
                    return;
                }

                // 6. Loop and Download
                for (const nb of notebooks) {
                    progress.report({ message: `Requesting definition for ${nb.displayName}...` });

                    let defResponse = await fetch(
                        `https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items/${nb.id}/getDefinition`,
                        {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${session.accessToken}` }
                        }
                    );

                    // Handle Long Running Operation (202 Accepted)
                    if (defResponse.status === 202) {
                        const monitorUrl = defResponse.headers.get('Location');
                        if (monitorUrl) {
                            let jobSucceeded = false;
                            while (!jobSucceeded) {
                                progress.report({ message: `Waiting for ${nb.displayName} to export...` });
                                await new Promise(res => setTimeout(res, 2000));
                                
                                const poll = await fetch(monitorUrl, {
                                    headers: { Authorization: `Bearer ${session.accessToken}` }
                                });
                                const jobData: any = await poll.json();

                                if (jobData.status === 'Succeeded') {
                                    jobSucceeded = true;
                                    defResponse = await fetch(`${monitorUrl}/result`, {
                                        headers: { Authorization: `Bearer ${session.accessToken}` }
                                    });
                                } else if (jobData.status === 'Failed') {
                                    throw new Error(`Job failed for ${nb.displayName}`);
                                }
                            }
                        }
                    }

                    // 7. Parse Result and Save File
                    const finalResult: any = await defResponse.json();
                    const parts = finalResult.definition?.parts || [];
                    
                    // Flexible match: Look for anything starting with notebook-content
                    const notebookPart = parts.find((p: any) => p.path.startsWith('notebook-content'));

                    if (notebookPart && notebookPart.payload) {
                        const buffer = Buffer.from(notebookPart.payload, 'base64');
                        
                        // Use the extension provided by Fabric (.py or .ipynb)
                        const ext = path.extname(notebookPart.path) || '.py';
                        const fileName = `${nb.displayName}${ext}`;
                        
                        fs.writeFileSync(path.join(workspaceFolder, fileName), buffer);
                    }
                }

                vscode.window.showInformationMessage(`Successfully downloaded ${notebooks.length} notebooks.`);
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
        }
    });

    context.subscriptions.push(downloadCommand);
}

export function deactivate() {}
