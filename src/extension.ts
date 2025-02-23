// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SftpServersProvider, SftpExplorerProvider } from './sftpViewProvider';
import { SettingsEditorProvider } from './settingsEditor';
import { ServerItem } from './sftpViewProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 创建输出通道
	const outputChannel = vscode.window.createOutputChannel('SFTP Tools');
	const log = (message: string) => {
		const timestamp = new Date().toLocaleTimeString();
		outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
	};

	log('SFTP Tools extension is activating...');

	// 注册服务器视图
	const sftpServersProvider = new SftpServersProvider();
	const sftpExplorerProvider = new SftpExplorerProvider(sftpServersProvider);

	// 注册视图
	vscode.window.registerTreeDataProvider('sftp-tools-servers', sftpServersProvider);
	vscode.window.registerTreeDataProvider('sftp-tools-explorer', sftpExplorerProvider);

	// 创建设置编辑器提供程序
	const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri);

	// 移除 showMessage 函数和调用
	log('SFTP Tools extension is ready!');
	outputChannel.show(true);

	// 注册命令
	context.subscriptions.push(
		vscode.commands.registerCommand('sftp-tools.showInfo', () => {
			const config = vscode.workspace.getConfiguration('sftp-tools');
			const servers = config.get('servers') || [];
			console.log('SFTP Tools Status:');
			console.log(`- Total servers configured: ${Object.keys(servers).length}`);
			console.log('- Configured servers:');
			Object.keys(servers).forEach((server: any) => {
				console.log(`  * ${server.name} (${server.host}:${server.port})`);
			});
			log(`SFTP Tools Info: ${Object.keys(servers).length} servers configured. Check Output for details.`);
		}),
		vscode.commands.registerCommand('sftp-tools.addServer', () => {
			sftpServersProvider.addServer();
		}),
		vscode.commands.registerCommand('sftp-tools.editServer', (item) => {
			settingsEditorProvider.showSettingsEditor(item);
		}),
		vscode.commands.registerCommand('sftp-tools.deleteServer', (item) => {
			sftpServersProvider.deleteServer(item);
		}),
		vscode.commands.registerCommand('sftp-tools.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'sftp-tools');
		}),
		vscode.commands.registerCommand('sftp-tools.refreshServers', () => {
			sftpServersProvider.refresh();
		}),
		vscode.commands.registerCommand('sftp-tools.refreshExplorer', () => {
			sftpExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('sftp-tools.openFile', (item) => {
			sftpExplorerProvider.openFile(item, false);
		}),
		vscode.commands.registerCommand('sftp-tools.uploadFile', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				sftpExplorerProvider.uploadFile(editor.document);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.openFileNonPreview', (item) => {
			sftpExplorerProvider.openFile(item, true);
		}),
		vscode.commands.registerCommand('sftp-tools.openSettingsEditor', () => {
			settingsEditorProvider.showSettingsEditor();
		}),
		vscode.commands.registerCommand('sftp-tools.connectServer', (serverItem: ServerItem) => {
			if (serverItem.serverConfig) {
				sftpExplorerProvider.connectToServer(serverItem.serverConfig);
			}
		}),
		vscode.commands.registerCommand('sftp-tools._updateUploadButton', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const uri = editor.document.uri.toString();
				const fileInfo = sftpExplorerProvider.getFileInfo(uri);
				if (fileInfo) {
					return `Upload to Server (${fileInfo.serverConfig.name})`;
				}
			}
			return 'Upload to Server';
		}),
		vscode.commands.registerCommand('sftp-tools.uploadToServer', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const servers = sftpExplorerProvider.getServers();
			if (servers.length === 0) {
				vscode.window.showInformationMessage('No servers configured');
				return;
			}

			// 创建服务器选择列表
			const items = servers.map(server => ({
				label: server.name,
				description: `${server.host}:${server.port}`,
				server: server
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select server to upload to'
			});

			if (selected) {
				await sftpExplorerProvider.uploadToServer(editor.document, selected.server);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.disconnectServer', (serverItem: ServerItem) => {
			sftpExplorerProvider.disconnectServer();
		}),
		vscode.commands.registerCommand('sftp-tools.uploadToAllServers', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				sftpExplorerProvider.uploadToAllServers(editor.document);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.downloadRemoteFile', (item) => {
			if (item) {
				sftpExplorerProvider.downloadRemoteFile(item);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.deleteRemoteFile', (item) => {
			if (item) {
				sftpExplorerProvider.deleteRemoteFile(item);
			}
		})
	);

	// 添加一个新的命令来检查文件是否是远程文件
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				const uri = editor.document.uri.toString();
				const isRemoteFile = sftpExplorerProvider.isRemoteFile(uri);
				vscode.commands.executeCommand('setContext', 'sftp-tools.isRemoteFile', isRemoteFile);
			}
		})
	);

	// 动态更新上传菜单
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				const servers = sftpExplorerProvider.getServers();
				vscode.commands.executeCommand('setContext', 'sftp-tools.hasServers', servers.length > 0);
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
