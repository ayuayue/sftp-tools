import * as vscode from 'vscode';
import { SftpManager } from './sftpManager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { time } from 'console';
import { StatusBarManager } from './statusBarManager';

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
    private activeServer?: string;  // 添加激活服务器标记

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
                    server,
                    false,
                    this.activeServer === server.name  // 传递激活状态
                ))
            );
        }
        return Promise.resolve([]);
    }

    async addServer() {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        const servers: ServerConfig[] = config.get('servers') || [];

        // 验证服务器名称
        const validateServerName = (name: string): string | undefined => {
            if (!name) {
                return '服务器名称不能为空';
            }
            if (servers.some(s => s.name === name)) {
                return '服务器名称已存在';
            }
            return undefined;
        };

        const name = await vscode.window.showInputBox({
            prompt: '输入服务器名称',
            validateInput: validateServerName
        });
        if (!name) { return; }

        const host = await vscode.window.showInputBox({ prompt: '输入主机地址' });
        if (!host) { return; }

        const port = await vscode.window.showInputBox({ 
            prompt: '输入端口',
            value: '22'
        });
        if (!port) { return; }

        const username = await vscode.window.showInputBox({ prompt: '输入用户名' });
        if (!username) { return; }

        const password = await vscode.window.showInputBox({ 
            prompt: '输入密码',
            password: true
        });
        if (!password) { return; }

        const remotePath = await vscode.window.showInputBox({ 
            prompt: '输入远程路径',
            value: '/'
        });
        if (!remotePath) { return; }

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

    // 添加设置激活服务器的方法
    setActiveServer(serverName: string) {
        this.activeServer = serverName;
        this.refresh();
    }
}

export class ServerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly serverConfig?: ServerConfig,
        public readonly isEmptyMessage: boolean = false,
        public readonly isActive: boolean = false  // 添加激活状态参数
    ) {
        super(label, collapsibleState);
        
        if (!isEmptyMessage) {
            this.tooltip = `${this.label} (${serverConfig?.host})`;
            this.description = serverConfig?.host;
            this.contextValue = isActive ? 'activeServer' : 'server';
            this.command = {
                command: 'sftp-tools.connectServer',
                title: 'Connect to Server',
                arguments: [this]
            };

            // 设置激活状态的图标
            if (isActive) {
                this.iconPath = new vscode.ThemeIcon('check');
                this.description = `${serverConfig?.host} (已连接)`;
            }
        } else {
            this.tooltip = '请添加新的服务器配置';
            this.iconPath = new vscode.ThemeIcon('info');
        }
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
    private serversProvider: SftpServersProvider;  // 添加引用
    private statusBar: StatusBarManager = StatusBarManager.getInstance();

    constructor(serversProvider: SftpServersProvider) {  // 通过构造函数注入
        this.serversProvider = serversProvider;
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
            this.serversProvider.setActiveServer(server.name);
            this.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
        }
    }

    async disconnectServer() {
        if (this.currentServer) {
            this.sftpManager.disconnect();
            this.currentServer = undefined;
            this.serversProvider.setActiveServer('');
            this.refresh();
            this.log('Disconnected from server', 'info');
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
            this.log(`[${this.currentServer?.name}] Opening file: ${item.path}`, 'info');
            
            if (!this.currentServer) {
                throw new Error('No server connected');
            }
            
            // 创建临时文件
            const tmpDir = path.join(os.tmpdir(), 'sftp-tools');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            // 使用完整路径作为文件名以保持唯一性
            const tempPath = path.join(tmpDir, `~${item.label.replace(/[\/\\]/g, '_')}`);
            
            // 获取并写入文件内容
            const content = await this.sftpManager.readFile(item.path);
            fs.writeFileSync(tempPath, content);
            
            this.log(`[${this.currentServer.name}] Created temp file: ${tempPath}`, 'info');

            // 打开文件
            const doc = await vscode.workspace.openTextDocument(tempPath);
            
            // 存储文件信息（在显示之前）
            this.remoteFiles.set(doc.uri.toString(), {
                remotePath: item.path,
                serverConfig: this.currentServer,
                tempPath: tempPath
            });
            
            // 设置语言
            await vscode.languages.setTextDocumentLanguage(doc, this.getLanguageId(item.label));
            
            // 显示文档
            await vscode.window.showTextDocument(doc, {
                preview: !isDoubleClick,
                preserveFocus: !isDoubleClick
            });
            
            // 设置上下文
            await vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', true);
            
        } catch (error: any) {
            this.log(`[${this.currentServer?.name}] Failed to open file: ${error.message}`, 'error');
            vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
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

    private getServerDisplayName(server: ServerConfig): string {
        return `${server.name} (${server.host}:${server.port})`;
    }

    async uploadFile(document: vscode.TextDocument) {
        const uri = document.uri.toString();
        const fileInfo = this.remoteFiles.get(uri);
        
        if (!fileInfo) {
            this.log(`[${this.currentServer?.name}] No remote file information found for: ${uri}`, 'error');
            return;
        }

        const serverDisplay = this.getServerDisplayName(fileInfo.serverConfig);

        try {
            // 显示状态栏消息
            this.statusBarItem.text = `$(cloud-upload) Uploading to [${this.currentServer?.name}]`;
            this.statusBarItem.show();

            this.log(`[${this.currentServer?.name}] Uploading:
 Local: [${fileInfo.tempPath}] -> Remote: [${fileInfo.remotePath}]`, 'info');

            await this.sftpManager.writeFile(fileInfo.remotePath, document.getText());
            
            // 更新状态栏消息
            this.statusBarItem.text = `$(check) Uploaded to [${this.currentServer?.name}]`;
            setTimeout(() => this.statusBarItem.hide(), 3000);

            this.log(`[${this.currentServer?.name}] File uploaded successfully `, 'info');
        } catch (error: any) {
            // 显示错误状态
            this.statusBarItem.text = `$(error) Upload failed`;
            setTimeout(() => this.statusBarItem.hide(), 3000);
            this.log(`[${this.currentServer?.name}] Failed to upload file : ${error.message}`, 'error');
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
            const serverDisplay = this.getServerDisplayName(fileInfo.serverConfig);
            vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', true);
            // 更新命令标题
            vscode.commands.executeCommand('setCommand', 'sftp-tools.uploadFile', {
                title: `Upload to [${this.currentServer?.name}]`,
                tooltip: `Upload to [${this.currentServer?.name}]`
            });
            return true;
        }
        return false;
    }

    getFileInfo(uri: string) {
        return this.remoteFiles.get(uri);
    }

    // 获取所有服务器配置
    public getServers(): ServerConfig[] {
        const config = vscode.workspace.getConfiguration('sftp-tools');
        return config.get('servers') || [];
    }

    // 上传到指定服务器
    async uploadToServer(document: vscode.TextDocument, serverConfig: ServerConfig) {
        try {
            this.statusBar.showProgress(`正在上传到 [${serverConfig.name}]...`);
            this.log(`[${serverConfig.name}] Uploading local file to remote server`, 'info');

            // 连接到指定服务器
            const tempManager = new SftpManager();
            await tempManager.connect(serverConfig);

            // 构建远程路径 - 使用文件名
            const fileName = path.basename(document.uri.fsPath);
            const remotePath = path.join(serverConfig.remotePath, fileName).replace(/\\/g, '/');

            // 上传文件
            await tempManager.writeFile(remotePath, document.getText());
            
            this.log(`[${serverConfig.name}] File uploaded successfully`, 'info');
            this.statusBar.showMessage(`文件已上传到 [${serverConfig.name}]`, 'info');

            // 断开连接
            tempManager.disconnect();
        } catch (error: any) {
            this.log(`[${serverConfig.name}] Failed to upload file: ${error.message}`, 'error');
            this.statusBar.showMessage(`上传失败: ${error.message}`, 'error');
        }
    }

    // 上传到所有服务器
    async uploadToAllServers(document: vscode.TextDocument) {
        const servers = this.getServers();
        if (servers.length === 0) {
            vscode.window.showInformationMessage('No servers configured');
            return;
        }

        let successCount = 0;
        let failCount = 0;

        // 显示进度
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Uploading to all servers",
            cancellable: false
        }, async (progress) => {
            const total = servers.length;
            
            for (let i = 0; i < servers.length; i++) {
                const server = servers[i];
                progress.report({ 
                    message: `Uploading to ${server.name} (${i + 1}/${total})`,
                    increment: (100 / total)
                });

                try {
                    await this.uploadToServer(document, server);
                    successCount++;
                } catch (error: any) {
                    failCount++;
                    this.log(`Failed to upload to ${server.name}: ${error.message}`, 'error');
                }
            }
        });

        // 显示结果
        if (failCount === 0) {
            vscode.window.showInformationMessage(`Successfully uploaded to ${successCount} servers`);
        } else {
            vscode.window.showWarningMessage(
                `Upload completed with ${successCount} successes and ${failCount} failures. Check output for details.`
            );
        }
    }

    async downloadRemoteFile(item: ExplorerItem) {
        try {
            if (!this.currentServer) {
                throw new Error('No server connected');
            }

            this.statusBar.showProgress(`正在下载文件...`);

            // 获取文件内容
            const content = await this.sftpManager.readFile(item.path);

            // 计算相对路径：从远程根路径到文件的相对路径
            let relativePath = item.path;
            if (item.path.startsWith(this.currentServer.remotePath)) {
                relativePath = item.path.substring(this.currentServer.remotePath.length);
            }
            // 确保路径分隔符正确且移除开头的斜杠
            relativePath = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');

            // 获取工作区根目录
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let localPath: string;

            if (workspaceFolder) {
                // 如果有工作区，使用工作区路径
                localPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            } else {
                // 如果没有工作区，让用户选择保存位置
                const defaultPath = path.join(os.homedir(), relativePath);
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultPath),
                    filters: {
                        'All Files': ['*']
                    }
                });

                if (!uri) {
                    return; // 用户取消了保存
                }
                localPath = uri.fsPath;
            }

            // 确保目标目录存在
            const targetDir = path.dirname(localPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 写入文件
            await vscode.workspace.fs.writeFile(vscode.Uri.file(localPath), Buffer.from(content));
            
            this.log(`[${this.currentServer.name}] File downloaded successfully to ${localPath}`, 'info');
            this.statusBar.showMessage(`文件已下载到: ${localPath}`, 'info');
        } catch (error: any) {
            this.log(`[${this.currentServer?.name}] Failed to download file: ${error.message}`, 'error');
            this.statusBar.showMessage(`下载失败: ${error.message}`, 'error');
        }
    }
    
    async deleteRemoteFile(item: ExplorerItem) {
        try {
            if (!this.currentServer) {
                throw new Error('No server connected');
            }

            // 确认删除
            const answer = await vscode.window.showWarningMessage(
                `确定要删除文件 "${item.label}" 吗？`,
                '确定',
                '取消'
            );

            if (answer === '确定') {
                this.statusBar.showProgress(`正在删除文件...`);
                
                // 删除文件
                await this.sftpManager.deleteFile(item.path);
                this.log(`[${this.currentServer.name}] File deleted successfully: ${item.path}`, 'info');
                this.statusBar.showMessage(`文件已删除`, 'info');
                this.refresh(); // 刷新文件列表
            }
        } catch (error: any) {
            this.log(`[${this.currentServer?.name}] Failed to delete file: ${error.message}`, 'error');
            this.statusBar.showMessage(`删除失败: ${error.message}`, 'error');
        }
    }

    // 获取当前活动的服务器
    public getCurrentServer(): ServerConfig | undefined {
        return this.currentServer;
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