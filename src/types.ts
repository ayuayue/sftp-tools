export interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    remotePath: string;
    workspacePath: string;
}

export interface WorkspaceConfig {
    servers: ServerConfig[];
    settings: {
        showConfirmDialog: boolean;
        uploadOrDeleteBackup: string;
    }
} 