"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function activate(context) {
    const disposable = vscode.commands.registerCommand('fabric-auth-demo.login', async () => {
        try {
            // Step 1: Get Microsoft session
            const session = await vscode.authentication.getSession('microsoft', ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: true });
            if (!session) {
                vscode.window.showErrorMessage('Login failed.');
                return;
            }
            const token = session.accessToken;
            // Step 2: Call Fabric (Power BI) API
            const response = await (0, node_fetch_1.default)('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (!response.ok) {
                const text = await response.text();
                vscode.window.showErrorMessage(`API error: ${response.status} ${text}`);
                return;
            }
            const data = await response.json();
            // Step 3: Show result
            const workspaceCount = data.value?.length ?? 0;
            vscode.window.showInformationMessage(`Logged in as ${session.account.label}. Found ${workspaceCount} workspaces.`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error: ${err.message || err}`);
        }
    });
    context.subscriptions.push(disposable);
    const downloadCommand = vscode.commands.registerCommand('fabric-auth-demo.downloadNotebooks', async () => {
        try {
            // 1. Get Session
            const session = await vscode.authentication.getSession('microsoft', ['https://analysis.windows.net/powerbi/api/.default'], { createIfNone: true });
            // 2. Fetch Workspaces
            const wsResponse = await (0, node_fetch_1.default)('https://api.powerbi.com/v1.0/myorg/groups', {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const wsData = await wsResponse.json();
            const workspaces = wsData.value || [];
            // 3. User selects Workspace
            const selectedWs = await vscode.window.showQuickPick(workspaces.map((ws) => ({
                label: ws.name,
                description: ws.id, // Good for the user to see
                id: ws.id
            })), { placeHolder: 'Select a workspace' }); // Cast the result
            if (!selectedWs)
                return;
            // 4. Fetch Notebooks (In Fabric, these are "items" of type "Notebook")
            // Note: Using the Fabric API endpoint
            const itemsResponse = await (0, node_fetch_1.default)(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items`, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            const itemsData = await itemsResponse.json();
            const notebooks = (itemsData.value || []).filter((i) => i.type === 'Notebook');
            if (notebooks.length === 0) {
                vscode.window.showInformationMessage('No notebooks found in this workspace.');
                return;
            }
            // 5. Download each notebook
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Please open a folder in VS Code first.');
                return;
            }
            const downloadFolder = path.join(workspaceFolder, 'fabric_notebooks');
            if (!fs.existsSync(downloadFolder))
                fs.mkdirSync(downloadFolder);
            for (const nb of notebooks) {
                // Fetch the notebook definition
                const defResponse = await (0, node_fetch_1.default)(`https://api.fabric.microsoft.com/v1/workspaces/${selectedWs.id}/items/${nb.id}/getDefinition`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                // Note: Fabric returns definition as base64 parts. 
                // For simplicity, we're saving the metadata. 
                // Real .ipynb conversion requires parsing the 'parts' array.
                const fileData = await defResponse.json();
                fs.writeFileSync(path.join(downloadFolder, `${nb.displayName}.json`), JSON.stringify(fileData, null, 2));
            }
            vscode.window.showInformationMessage(`Downloaded ${notebooks.length} notebooks to /fabric_notebooks`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
        }
    });
    context.subscriptions.push(downloadCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map