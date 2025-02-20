import * as vscode from 'vscode';
import { SftpManager } from './sftpManager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    remotePath: string;
}

export class SftpServersProvider implements vscode.TreeDataProvider<ServerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerItem | undefined | null | void> = new vscode.EventEmitter<ServerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {
        // 监听配置变化
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sftp-tools.servers')) {
                this.refresh();
            }
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ServerItem): Thenable<ServerItem[]> {
        if (!element) {
            const config = vscode.workspace.getConfiguration('sftp-tools');
            const servers: ServerConfig[] = config.get('servers') || [];
            return Promise.resolve(
                servers.map(server => new ServerItem(
                    server.name,
                    vscode.TreeItemCollapsibleState.None,
                    server
                ))
            );
        }
        return Promise.resolve([]);
    }

    async addServer() {
        const name = await vscode.window.showInputBox({ prompt: 'Enter server name' });
        if (!name) { return; }

        const host = await vscode.window.showInputBox({ prompt: 'Enter host' });
        if (!host) { return; }

        const port = await vscode.window.showInputBox({ 
            prompt: 'Enter port',
            value: '22'
        });
        if (!port) { return; }

        const username = await vscode.window.showInputBox({ prompt: 'Enter username' });
        if (!username) { return; }

        const password = await vscode.window.showInputBox({ 
            prompt: 'Enter password',
            password: true
        });
        if (!password) { return; }

        const remotePath = await vscode.window.showInputBox({ 
            prompt: 'Enter remote path',
            value: '/'
        });
        if (!remotePath) { return; }

        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers: ServerConfig[] = config.get('servers') || [];
        
        servers.push({
            name,
            host,
            port: parseInt(port),
            username,
            password,
            remotePath
        });

        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
    }

    async editServer(serverItem: ServerItem) {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers: ServerConfig[] = config.get('servers') || [];
        const index = servers.findIndex(s => s.name === serverItem.label);
        
        if (index === -1) { return; }

        const server = servers[index];
        const name = await vscode.window.showInputBox({ 
            prompt: 'Enter server name',
            value: server.name
        });
        if (!name) { return; }

        // ... 类似的输入其他字段 ...

        servers[index] = {
            ...server,
            name
            // ... 更新其他字段 ...
        };

        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
    }

    async deleteServer(serverItem: ServerItem) {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to delete server "${serverItem.label}"?`,
            'Yes',
            'No'
        );

        if (answer !== 'Yes') {
            return;
        }

        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers: ServerConfig[] = config.get('servers') || [];
        const newServers = servers.filter(s => s.name !== serverItem.label);
        await config.update('servers', newServers, vscode.ConfigurationTarget.Global);
    }
}

export class ServerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly serverConfig?: ServerConfig
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label} (${serverConfig?.host})`;
        this.description = serverConfig?.host;
        this.contextValue = 'server';
        this.command = {
            command: 'sftp-tools.connectServer',
            title: 'Connect to Server',
            arguments: [this]
        };
    }
}

export class SftpExplorerProvider implements vscode.TreeDataProvider<ExplorerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExplorerItem | undefined | null | void> = new vscode.EventEmitter<ExplorerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ExplorerItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private sftpManager: SftpManager = new SftpManager();
    private currentServer?: ServerConfig;
    private remoteFiles = new Map<string, {
        remotePath: string;
        serverConfig: ServerConfig;
        tempPath?: string;  // 添加临时文件路径
    }>();
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('SFTP Tools');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        // 监听配置变化
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sftp-tools.servers')) {
                this.updateCurrentServer();
            }
        });

        // 监听 VS Code 关闭事件
        vscode.workspace.onDidCloseTextDocument(doc => {
            const fileInfo = this.remoteFiles.get(doc.uri.toString());
            if (fileInfo?.tempPath) {
                try {
                    fs.unlinkSync(fileInfo.tempPath);
                    console.log(`Cleaned up temp file: ${fileInfo.tempPath}`);
                } catch (error) {
                    console.error('Failed to cleanup temp file:', error);
                }
            }
        });
    }

    private async updateCurrentServer() {
        if (this.currentServer) {
            const config = vscode.workspace.getConfiguration('sftp-tools');
            const servers: ServerConfig[] = config.get('servers') || [];
            const updatedServer = servers.find(s => s.name === this.currentServer?.name);
            
            if (updatedServer) {
                this.currentServer = updatedServer;
                // 重新连接到更新后的服务器
                await this.connectToServer(updatedServer);
            } else {
                // 如果服务器被删除，清除当前连接
                this.currentServer = undefined;
                this.sftpManager.disconnect();
                this.refresh();
            }
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async connectToServer(server: ServerConfig) {
        try {
            await this.sftpManager.connect(server);
            this.currentServer = server;
            this.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
        }
    }

    getTreeItem(element: ExplorerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ExplorerItem): Promise<ExplorerItem[]> {
        if (!this.currentServer) {
            return [];
        }

        try {
            const path = element ? element.path : this.currentServer.remotePath;
            const files = await this.sftpManager.listFiles(path);
            
            return files.map(file => new ExplorerItem(
                file.filename,
                file.longname.startsWith('d') ? 
                    vscode.TreeItemCollapsibleState.Collapsed : 
                    vscode.TreeItemCollapsibleState.None,
                `${path}/${file.filename}`.replace(/\/+/g, '/'),
                file.longname.startsWith('d')
            ));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to list files: ${error.message}`);
            return [];
        }
    }

    // 替换 showMessage 方法
    private log(message: string, type: 'info' | 'warning' | 'error' = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
        this.outputChannel.show(true);  // true 表示保持焦点在编辑器
    }

    async openFile(item: ExplorerItem, isDoubleClick = false) {
        try {
            this.log(`Opening file: ${item.path}`, 'info');
            
            // 创建临时文件
            const tmpDir = path.join(os.tmpdir(), 'sftp-tools');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            const tempPath = path.join(tmpDir, `${this.currentServer?.name}-${item.label}`);
            fs.writeFileSync(tempPath, await this.sftpManager.readFile(item.path));
            
            this.log(`Created temp file: ${tempPath}`, 'info');
            
            // 确保在打开文件前设置语言
            const doc = await vscode.workspace.openTextDocument({
                uri: vscode.Uri.file(tempPath),
                language: this.getLanguageId(item.label)
            });

            // 存储文件信息
            this.remoteFiles.set(doc.uri.toString(), {
                remotePath: item.path,
                serverConfig: this.currentServer!,
                tempPath: tempPath
            });

            // 打开文件
            await vscode.window.showTextDocument(doc, {
                preview: !isDoubleClick,
                preserveFocus: !isDoubleClick
            });

            // 设置上下文
            await vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', true);
            
        } catch (error: any) {
            this.log(`Failed to open file: ${error.message}`, 'error');
        }
    }

    private getLanguageId(filename: string): string {
        // 根据文件扩展名返回语言ID
        const ext = filename.split('.').pop()?.toLowerCase();
        // 添加更多文件类型支持
        const langMap: { [key: string]: string } = {
            'js': 'javascript',
            'ts': 'typescript',
            'json': 'json',
            'md': 'markdown',
            'txt': 'plaintext',
            // ... 添加更多映射
        };
        return langMap[ext || ''] || 'plaintext';
    }

    // 修改上传方法
    async uploadFile(document: vscode.TextDocument) {
        const uri = document.uri.toString();
        const fileInfo = this.remoteFiles.get(uri);
        
        if (!fileInfo) {
            this.log(`No remote file information found for: ${uri}`, 'error');
            return;
        }

        try {
            // 显示状态栏消息
            this.statusBarItem.text = `$(cloud-upload) Uploading to ${fileInfo.serverConfig.name}...`;
            this.statusBarItem.show();

            this.log(`Uploading file: ${fileInfo.remotePath}`, 'info');
            await this.sftpManager.writeFile(fileInfo.remotePath, document.getText());
            
            // 更新状态栏消息
            this.statusBarItem.text = `$(check) Uploaded to ${fileInfo.serverConfig.name}`;
            setTimeout(() => this.statusBarItem.hide(), 3000);

            this.log(`File uploaded successfully:
Local: ${fileInfo.tempPath}
Remote: ${fileInfo.remotePath}`, 'info');
        } catch (error: any) {
            // 显示错误状态
            this.statusBarItem.text = `$(error) Upload failed`;
            setTimeout(() => this.statusBarItem.hide(), 3000);
            this.log(`Failed to upload file: ${error.message}`, 'error');
        }
    }

    // 清理临时文件
    private cleanupTempFiles() {
        for (const fileInfo of this.remoteFiles.values()) {
            if (fileInfo.tempPath && fs.existsSync(fileInfo.tempPath)) {
                try {
                    fs.unlinkSync(fileInfo.tempPath);
                    console.log(`Cleaned up temp file: ${fileInfo.tempPath}`);
                } catch (error) {
                    console.error('Failed to cleanup temp file:', error);
                }
            }
        }
    }

    isRemoteFile(uri: string): boolean {
        const fileInfo = this.remoteFiles.get(uri);
        if (fileInfo) {
            // 更新上传按钮的标题
            vscode.commands.executeCommand('setContext', 'sftp-tools.serverName', fileInfo.serverConfig.name);
            return true;
        }
        return false;
    }

    getFileInfo(uri: string) {
        return this.remoteFiles.get(uri);
    }
}

export class ExplorerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly path: string,
        public readonly isDirectory: boolean
    ) {
        super(label, collapsibleState);
        this.tooltip = this.path;
        
        if (!isDirectory) {
            this.command = {
                command: 'sftp-tools.openFile',
                title: 'Open File',
                arguments: [this]  // 移除第二个参数
            };
            this.contextValue = 'file';
        }
    }
} 