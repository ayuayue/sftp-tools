import * as vscode from 'vscode';

const zh = {
    view: {
        servers: 'SFTP 服务器',
        explorer: '文件浏览器'
    },
    settings: {
        title: 'SFTP 设置',
        otherSettings: '其他设置',
        serverSettings: '服务器设置',
        showDeleteConfirm: '删除前确认',
        showDeleteConfirmDesc: '删除远程文件或文件夹前是否显示确认对话框',
        serverName: '服务器名称',
        serverNameRequired: '服务器名称不能为空',
        serverNameExists: '服务器名称已存在',
        enterServerName: '输入服务器名称',
        enterHost: '输入主机地址',
        enterPort: '输入端口',
        enterUsername: '输入用户名',
        enterPassword: '输入密码',
        selectAuthType: '选择认证方式',
        selectPrivateKey: '选择私钥文件',
        needPassphrase: '私钥文件是否需要密码短语？',
        enterPassphrase: '输入私钥密码短语',
        enterRemotePath: '输入远程路径',
        enterLocalPath: '输入本地工作区目录,/ 为当前工作区',
        host: '主机地址',
        port: '端口',
        username: '用户名',
        password: '密码',
        privateKey: '私钥文件',
        passphrase: '密码短语',
        remotePath: '远程目录',
        localPath: '本地工作区目录',
        paths: '路径设置',
        authType: '认证方式',
        authPassword: '密码认证',
        authPrivateKey: '密钥文件',
        addServer: '添加服务器',
        saveAll: '保存全部',
        emptyTip: '还没有配置任何服务器',
        deleteConfirm: '确定要删除吗？',
        delete: '删除',
        yes: '是',
        no: '否',
        clickAddServerTip: '点击 添加服务器 按钮开始配置',
        clickSaveAllTip: '配置完成后点击 保存全部 按钮保存更改',
        configureNow: '配置服务器',
        useGlobalConfig: '使用全局配置',
        useGlobalConfigDesc: '启用后，所有工作区将使用相同的服务器配置；禁用后，每个工作区有独立配置',
        enterPrivateKeyPath: '输入或选择私钥文件路径'
    },
    status: {
        uploading: '正在上传...',
        uploadSuccess: '上传成功',
        uploadFailed: '上传失败',
        downloading: '正在下载...',
        downloadSuccess: '下载成功',
        downloadFailed: '下载失败',
        connecting: '正在连接...',
        connected: '已连接',
        disconnected: '已断开连接',
        operationCancelled: '操作已取消',
        noWorkspace: '没有找到工作区',
        directoryCreated: '目录已创建',
        directoryCreateFailed: '创建目录失败',
        uploadingDirectory: '正在上传目录...',
        uploadDirectorySuccess: '目录上传成功',
        directoryDeleted: '目录已删除',
        fileDeleted: '文件已删除',
        uploadingToServer: '正在上传到 {0}',
        settingsSaved: '设置已保存',
        configMigrated: '已成功将旧版配置迁移到新版格式。'
    },
    messages: {
        confirmDelete: '确定要删除{0}吗？',
        pathNotFound: '路径不存在',
        uploadComplete: '上传完成',
        downloadComplete: '下载完成',
        operationFailed: '操作失败: {0}',
        noServersConfigured: '还没有配置任何服务器',
        configureNow: '是否现在配置？',
        selectServer: '选择服务器',
        uploadPartialSuccess: '上传完成，{0} 个成功，{1} 个失败。请查看输出日志了解详情。',
        uploadToServer: '上传到 {0}',
        uploadingToServer: '正在上传到 {0}...',
        uploadingProgress: '正在上传到 {0} ({1}/{2})',
        serverConnected: '已连接到 {0}',
        serverDisconnected: '已断开与 {0} 的连接',
        autoInputPasswordPrompt: '是否自动输入保存的密码？',
        sshConnectionFailed: 'SSH 连接失败: {0}',
        noServer: '没有连接到服务器',
        settingsSaveFailed: '保存失败: 无法写入配置文件'
    }
};

const en = {
    view: {
        servers: 'SFTP Servers',
        explorer: 'File Explorer'
    },
    settings: {
        title: 'SFTP Settings',
        otherSettings: 'Other Settings',
        serverSettings: 'Server Settings',
        showDeleteConfirm: 'Confirm before delete',
        showDeleteConfirmDesc: 'Show confirmation dialog before deleting remote files or folders',
        serverName: 'Server Name',
        serverNameRequired: 'Server name is required',
        serverNameExists: 'Server name already exists',
        enterServerName: 'Enter server name',
        enterHost: 'Enter host address',
        enterPort: 'Enter port',
        enterUsername: 'Enter username',
        enterPassword: 'Enter password',
        selectAuthType: 'Select authentication type',
        selectPrivateKey: 'Select private key file',
        needPassphrase: 'Does the private key require a passphrase?',
        enterPassphrase: 'Enter private key passphrase',
        enterRemotePath: 'Enter remote path',
        enterLocalPath: 'Enter local workspace path, / is the current workspace',
        host: 'Host',
        port: 'Port',
        username: 'Username',
        password: 'Password',
        privateKey: 'Private Key File',
        passphrase: 'Passphrase',
        remotePath: 'Remote Path',
        localPath: 'Local Workspace Path',
        paths: 'Path Settings',
        authType: 'Authentication Type',
        authPassword: 'Password',
        authPrivateKey: 'Private Key',
        addServer: 'Add Server',
        saveAll: 'Save All',
        emptyTip: 'No servers configured yet',
        deleteConfirm: 'Are you sure you want to delete?',
        delete: 'Delete',
        yes: 'Yes',
        no: 'No',
        clickAddServerTip: 'Click the Add Server button to start configuring',
        clickSaveAllTip: 'Click Save All button to save changes after configuration',
        configureNow: 'Configure Server',
        useGlobalConfig: 'Use global configuration',
        useGlobalConfigDesc: 'When enabled, all workspaces will use the same server configurations; when disabled, each workspace has its own configuration',
        enterPrivateKeyPath: 'Enter or select private key file path'
    },
    status: {
        uploading: 'Uploading...',
        uploadSuccess: 'Upload successful',
        uploadFailed: 'Upload failed',
        downloading: 'Downloading...',
        downloadSuccess: 'Download successful',
        downloadFailed: 'Download failed',
        connecting: 'Connecting...',
        connected: 'Connected',
        disconnected: 'Disconnected',
        operationCancelled: 'Operation cancelled',
        noWorkspace: 'No workspace found',
        directoryCreated: 'Directory created',
        directoryCreateFailed: 'Failed to create directory',
        uploadingDirectory: 'Uploading directory...',
        uploadDirectorySuccess: 'Directory upload successful',
        directoryDeleted: 'Directory deleted',
        fileDeleted: 'File deleted',
        uploadingToServer: 'Uploading to {0}',
        settingsSaved: 'Settings saved',
        configMigrated: 'Successfully migrated configuration from old version to new format.'
    },
    messages: {
        confirmDelete: 'Are you sure you want to delete {0}?',
        pathNotFound: 'Path not found',
        uploadComplete: 'Upload complete',
        downloadComplete: 'Download complete',
        operationFailed: 'Operation failed: {0}',
        noServersConfigured: 'No servers configured',
        configureNow: 'Configure now?',
        selectServer: 'Select server',
        uploadPartialSuccess: 'Upload completed with {0} successes and {1} failures. Check output for details.',
        uploadToServer: 'Uploading to {0}',
        uploadingToServer: 'Uploading to {0}...',
        uploadingProgress: 'Uploading to {0} ({1}/{2})',
        serverConnected: 'Connected to {0}',
        serverDisconnected: 'Disconnected from {0}',
        autoInputPasswordPrompt: 'Do you want to auto-input the saved password?',
        sshConnectionFailed: 'SSH connection failed: {0}',
        noServer: 'No server connected',
        settingsSaveFailed: 'Save failed: Cannot write to configuration file'
    }
};

export function getLocaleText() {
    // 获取 VS Code 的语言设置
    const locale = vscode.env.language;
    return locale.toLowerCase().startsWith('zh') ? zh : en;
} 