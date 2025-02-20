import * as vscode from 'vscode';
import { ServerItem } from './sftpViewProvider';

export class SettingsEditorProvider {
    public static readonly viewType = 'sftp-tools.settingsEditor';
    private _view?: vscode.WebviewPanel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public async showSettingsEditor(serverToEdit?: ServerItem) {
        if (this._view) {
            this._view.reveal(vscode.ViewColumn.One);
            
            if (serverToEdit) {
                this._view.webview.postMessage({ 
                    command: 'editServer',
                    serverName: serverToEdit.label 
                });
            }
            return;
        }

        this._view = vscode.window.createWebviewPanel(
            'sftpSettings',
            'SFTP Tools Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers = config.get('servers') || [];
        
        this._view.webview.html = this._getHtmlForWebview();
        
        setTimeout(() => {
            this._view?.webview.postMessage({ command: 'loadSettings', servers });
            if (serverToEdit) {
                this._view?.webview.postMessage({ 
                    command: 'editServer',
                    serverName: serverToEdit.label 
                });
            }
        }, 100);

        this._view.onDidDispose(() => {
            this._view = undefined;
        });

        this._view.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.command) {
                    case 'saveSettings':
                        await this._saveSettings(message.servers);
                        vscode.window.showInformationMessage('Settings saved successfully!');
                        break;
                    case 'confirmDelete':
                        const answer = await vscode.window.showWarningMessage(
                            'Are you sure you want to delete this server?',
                            'Yes',
                            'No'
                        );
                        if (answer === 'Yes') {
                            this._view?.webview.postMessage({
                                command: 'deleteConfirmed',
                                index: message.index
                            });
                        }
                        break;
                    default:
                        console.log('Unknown command:', message.command);
                }
            } catch (error) {
                console.error('Error handling message:', error);
                vscode.window.showErrorMessage('Failed to save settings');
            }
        });
    }

    private async _saveSettings(servers: any[]) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
    }

    private _getHtmlForWebview(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>SFTP Settings</title>
                <style>
                    body { padding: 20px; }
                    .server-form { margin-bottom: 20px; }
                    input, button { margin: 5px 0; }
                    .server-list { margin-top: 20px; }
                    .server-item { 
                        border: 1px solid var(--vscode-input-border); 
                        padding: 10px; 
                        margin: 10px 0; 
                    }
                    .form-group {
                        margin-bottom: 10px;
                    }
                    .form-group label {
                        display: block;
                        margin-bottom: 5px;
                    }
                    .form-group input {
                        width: 100%;
                        padding: 5px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                    }
                    .actions {
                        margin-top: 10px;
                        display: flex;
                        justify-content: flex-end;
                    }
                    .global-actions {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        background: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 4px;
                        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    }
                    .deleteBtn {
                        background: var(--vscode-errorForeground);
                    }
                    .server-list {
                        margin-bottom: 80px; /* 为固定按钮留出空间 */
                    }
                </style>
            </head>
            <body>
                <div class="server-list" id="serverList"></div>
                <div class="global-actions">
                    <button id="addServerBtn">Add Server</button>
                    <button id="saveSettingsBtn">Save All</button>
                </div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    let servers = [];

                    document.getElementById('addServerBtn').addEventListener('click', addServer);
                    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

                    window.addEventListener('message', event => {
                        console.log('Received message:', event.data);
                        const message = event.data;
                        switch (message.command) {
                            case 'loadSettings':
                                servers = message.servers || [];
                                renderServers();
                                break;
                            case 'editServer':
                                const serverItem = document.querySelector('[data-server-name="'+message.serverName+'"]');
                                if (serverItem) {
                                    serverItem.scrollIntoView({ behavior: 'smooth' });
                                    serverItem.classList.add('highlight');
                                    setTimeout(() => serverItem.classList.remove('highlight'), 2000);
                                }
                                break;
                            case 'deleteConfirmed':
                                servers.splice(message.index, 1);
                                renderServers();
                                break;
                        }
                    });

                    function renderServers() {
                        const serverList = document.getElementById('serverList');
                        serverList.innerHTML = servers.map((server, index) => {
                            const serverDiv = document.createElement('div');
                            serverDiv.className = 'server-item';
                            serverDiv.dataset.serverName = server.name;
                            serverDiv.innerHTML = \`
                                <div class="form-group">
                                    <label>Name:</label>
                                    <input type="text" value="\${server.name}" data-index="\${index}" data-field="name">
                                </div>
                                <div class="form-group">
                                    <label>Host:</label>
                                    <input type="text" value="\${server.host}" data-index="\${index}" data-field="host">
                                </div>
                                <div class="form-group">
                                    <label>Port:</label>
                                    <input type="number" value="\${server.port}" data-index="\${index}" data-field="port">
                                </div>
                                <div class="form-group">
                                    <label>Username:</label>
                                    <input type="text" value="\${server.username}" data-index="\${index}" data-field="username">
                                </div>
                                <div class="form-group">
                                    <label>Password:</label>
                                    <input type="password" value="\${server.password}" data-index="\${index}" data-field="password">
                                </div>
                                <div class="form-group">
                                    <label>Remote Path:</label>
                                    <input type="text" value="\${server.remotePath}" data-index="\${index}" data-field="remotePath">
                                </div>
                                <div class="actions">
                                    <button class="deleteBtn" data-index="\${index}">Delete</button>
                                </div>
                            \`;

                            serverDiv.querySelectorAll('input').forEach(input => {
                                input.addEventListener('change', (e) => {
                                    const target = e.target;
                                    const index = parseInt(target.dataset.index);
                                    const field = target.dataset.field;
                                    updateServer(index, field, target.value);
                                });
                            });

                            serverDiv.querySelector('.deleteBtn').addEventListener('click', () => {
                                deleteServer(index);
                            });

                            return serverDiv.outerHTML;
                        }).join('');

                        document.querySelectorAll('.server-item input').forEach(input => {
                            input.addEventListener('change', (e) => {
                                const target = e.target;
                                const index = parseInt(target.dataset.index);
                                const field = target.dataset.field;
                                updateServer(index, field, target.value);
                            });
                        });

                        document.querySelectorAll('.deleteBtn').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const index = parseInt(btn.dataset.index);
                                deleteServer(index);
                            });
                        });
                    }

                    function updateServer(index, field, value) {
                        servers[index][field] = value;
                    }

                    function addServer() {
                        console.log('Adding server');
                        servers.push({
                            name: '',
                            host: '',
                            port: 22,
                            username: '',
                            password: '',
                            remotePath: '/'
                        });
                        renderServers();
                    }

                    async function deleteServer(index) {
                        vscode.postMessage({
                            command: 'confirmDelete',
                            index: index
                        });
                    }

                    function saveSettings() {
                        console.log('Saving settings:', servers);
                        vscode.postMessage({
                            command: 'saveSettings',
                            servers: servers
                        });
                    }
                </script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 