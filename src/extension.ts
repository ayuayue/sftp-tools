// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SftpServersProvider, SftpExplorerProvider } from './sftpViewProvider';
import { SettingsEditor } from './settingsEditor';
import { ServerItem } from './sftpViewProvider';
import { getLocaleText } from './i18n';
import { Logger } from './utils/logger';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const currentVersion = context.extension.packageJSON.version;
	// 保存当前版本
	context.globalState.update('sftp-tools.version', currentVersion);

	// 创建输出通道
	const outputChannel = vscode.window.createOutputChannel('SFTP Tools');
	const logger = Logger.getInstance();

	// 获取 Logger 实例并显示欢迎信息
	logger.showWelcome();

	// 创建设置编辑器提供程序
	const settingsEditorProvider = new SettingsEditor(context.extensionUri);

	// 先注册设置编辑器命令
	context.subscriptions.push(
		vscode.commands.registerCommand('sftp-tools.openSettingsEditor', () => {
			settingsEditorProvider.showSettingsEditor();
		})
	);

	// 注册服务器视图
	const sftpServersProvider = new SftpServersProvider();
	const sftpExplorerProvider = new SftpExplorerProvider(sftpServersProvider);

	// 注册视图
	vscode.window.registerTreeDataProvider('sftp-tools-servers', sftpServersProvider);
	vscode.window.registerTreeDataProvider('sftp-tools-explorer', sftpExplorerProvider);

	outputChannel.show(true);

	// 注册命令
	context.subscriptions.push(
		vscode.commands.registerCommand('sftp-tools.showInfo', () => {
			const config = vscode.workspace.getConfiguration('sftp-tools');
			const outputChannel = vscode.window.createOutputChannel('SFTP Tools');
			const servers = config.get('servers') || [];
			outputChannel.appendLine('SFTP Tools Status:');
			outputChannel.appendLine(`- Total servers configured: ${Object.keys(servers).length}`);
			outputChannel.appendLine('- Configured servers:');
			Object.values(servers).forEach((server: any) => {
				outputChannel.appendLine(`  * ${server.name} (${server.host}:${server.port})`);
			});
			logger.log(`SFTP Tools Info: ${Object.keys(servers).length} servers configured. Check Output for details.`);
			outputChannel.show(true);
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
		vscode.commands.registerCommand('sftp-tools.uploadFile', async (uri?: vscode.Uri) => {
			// 如果命令是从资源管理器触发的，会传入 uri 参数
			if (!uri) {
				// 如果没有传入 uri，尝试从活动编辑器获取
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					uri = editor.document.uri;
				}
			}

			if (!uri) {
				vscode.window.showErrorMessage('没有选择要上传的文件');
				return;
			}

			const servers = sftpExplorerProvider.getServers();
			if (servers.length === 0) {
				const answer = await vscode.window.showInformationMessage(
					'还没有配置任何服务器，是否现在配置？',
					'配置服务器',
					'取消'
				);
				
				if (answer === '配置服务器') {
					vscode.commands.executeCommand('sftp-tools.openSettingsEditor');
				}
				return;
			}

			const currentServer = sftpExplorerProvider.getCurrentServer();
			if (!currentServer) {
				const answer = await vscode.window.showInformationMessage(
					'没有连接到任何服务器，请先连接一个服务器',
					'选择服务器',
					'取消'
				);
				
				if (answer === '选择服务器') {
					vscode.commands.executeCommand('sftp-tools.uploadToServer', uri);
				}
				return;
			}

			// 读取文件内容并上传
			try {
				const content = await vscode.workspace.fs.readFile(uri);
				await sftpExplorerProvider.uploadFileContent(uri, content, currentServer);
			} catch (error: any) {
				vscode.window.showErrorMessage(`上传失败: ${error.message}`);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.openFileNonPreview', (item) => {
			sftpExplorerProvider.openFile(item, true);
		}),
		vscode.commands.registerCommand('sftp-tools.connectServer', (serverItem: ServerItem) => {
			if (serverItem.config) {
				sftpExplorerProvider.connectToServer(serverItem.config);
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
				vscode.window.showInformationMessage('没有配置任何服务器');
				return;
			}

			// 创建服务器选择列表
			const items = servers.map(server => ({
				label: server.name,
				description: `${server.host}:${server.port}`,
				server: server
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: '选择要上传到的服务器'
			});

			if (selected) {
				// 先连接并激活服务器
				await sftpExplorerProvider.connectToServer(selected.server);
				// 然后上传文件
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
		}),
		vscode.commands.registerCommand('sftp-tools.cancelOperations', () => {
			sftpExplorerProvider.cancelOperations();
		}),
		vscode.commands.registerCommand('sftp-tools.disconnectAllServers', () => {
			sftpExplorerProvider.disconnectAllServers();
		}),
		vscode.commands.registerCommand('sftp-tools.connectSSH', (serverItem: ServerItem) => {
			sftpServersProvider.connectSSH(serverItem);
		}),
		vscode.commands.registerCommand('sftp-tools.uploadDirectory', async (uri: vscode.Uri) => {
			const servers = sftpExplorerProvider.getServers();
			const i18n = getLocaleText();
			if (servers.length === 0) {
				const answer = await vscode.window.showInformationMessage(
					i18n.messages.noServersConfigured,
					i18n.settings.configureNow,
					i18n.settings.no
				);
				if (answer === i18n.settings.configureNow) {
					vscode.commands.executeCommand('sftp-tools.openSettingsEditor');
				}
				return;
			}
			const currentServer = sftpExplorerProvider.getCurrentServer();
			if (!currentServer) {
				const answer = await vscode.window.showInformationMessage(
					i18n.messages.noServer,
					i18n.messages.selectServer,
					i18n.settings.no
				);
				if (answer === i18n.messages.selectServer) {
					vscode.commands.executeCommand('sftp-tools.uploadDirectoryToServer', uri);
				}
				return;
			}
			await sftpExplorerProvider.uploadDirectory(uri, currentServer);
		}),
		vscode.commands.registerCommand('sftp-tools.uploadDirectoryToServer', async (uri: vscode.Uri) => {
			const servers = sftpExplorerProvider.getServers();
			const i18n = getLocaleText();
			if (servers.length === 0) {
				vscode.window.showInformationMessage(i18n.messages.noServersConfigured);
				return;
			}

			// 创建服务器选择列表
			const items = servers.map(server => ({
				label: server.name,
				description: `${server.host}:${server.port}`,
				server: server
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: i18n.messages.selectServer
			});

			if (selected) {
				// 先连接并激活服务器
				await sftpExplorerProvider.connectToServer(selected.server);
				// 然后上传目录
				await sftpExplorerProvider.uploadDirectory(uri, selected.server);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.uploadDirectoryToAllServers', async (uri: vscode.Uri) => {
			const servers = sftpExplorerProvider.getServers();
			const i18n = getLocaleText();
			if (servers.length === 0) {
				vscode.window.showInformationMessage(i18n.messages.noServersConfigured);
				return;
			}

			let successCount = 0;
			let failCount = 0;

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: i18n.status.uploadingDirectory,
				cancellable: false
			}, async (progress) => {
				const total = servers.length;
				
				for (let i = 0; i < servers.length; i++) {
					const server = servers[i];
					progress.report({ 
						message: `${i18n.status.uploadingToServer.replace('{0}', server.name)} (${i + 1}/${total})`,
						increment: (100 / total)
					});

					try {
						await sftpExplorerProvider.uploadDirectory(uri, server);
						successCount++;
					} catch (error: any) {
						failCount++;
						vscode.window.showErrorMessage(i18n.messages.operationFailed.replace('{0}', `${server.name}: ${error.message}`));
					}
				}
			});

			if (failCount === 0) {
				vscode.window.showInformationMessage(i18n.messages.uploadComplete);
			} else {
				vscode.window.showWarningMessage(
					i18n.messages.uploadPartialSuccess.replace('{0}', successCount.toString()).replace('{1}', failCount.toString())
				);
			}
		}),
		vscode.commands.registerCommand('sftp-tools.settingsUpdated', (servers) => {
			// 通知设置编辑器配置已更新
			settingsEditorProvider.notifySettingsUpdated(servers);
		}),
		vscode.commands.registerCommand('sftp-tools.updateOtherSetting', async (setting: string, value: any) => {
			settingsEditorProvider.updateSettings({ [setting]: value });
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
