import * as ssh2 from 'ssh2';
import * as vscode from 'vscode';

export class SftpManager {
    private client: ssh2.Client | null = null;
    private sftp: ssh2.SFTPWrapper | null = null;

    async connect(serverConfig: any): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client = new ssh2.Client();

            this.client.on('ready', () => {
                this.client!.sftp((err: any, sftp: any) => {
                    if (err) {
                        reject(err);
                    }
                    this.sftp = sftp;
                    resolve();
                });
            }).on('error', (err: any) => {
                reject(err);
            }).connect({
                host: serverConfig.host,
                port: serverConfig.port,
                username: serverConfig.username,
                password: serverConfig.password
            });
        });
    }

    async listFiles(path: string): Promise<ssh2.FileEntry[]> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.sftp.readdir(path, (err: any, list: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(list);
            });
        });
    }

    async readFile(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.sftp.readFile(path, 'utf8', (err: any, data: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }

    async writeFile(path: string, content: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            // 先备份原文件
            this.sftp.rename(path, `${path}.bak`, (renameErr) => {
                // 即使备份失败也继续写入新文件
                this.sftp!.writeFile(path, content, (err: any) => {
                    if (err) {
                        // 如果写入失败且有备份，尝试恢复
                        if (!renameErr) {
                            this.sftp!.rename(`${path}.bak`, path, () => {});
                        }
                        reject(err);
                        return;
                    }
                    // 写入成功后删除备份
                    if (!renameErr) {
                        this.sftp!.unlink(`${path}.bak`, () => {});
                    }
                    resolve();
                });
            });
        });
    }

    disconnect() {
        if (this.client) {
            this.client.end();
            this.client = null;
            this.sftp = null;
        }
    }
} 