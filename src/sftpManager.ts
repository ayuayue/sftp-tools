import * as ssh2 from 'ssh2';

export class SftpManager {
    private client: ssh2.Client | null = null;
    private sftp: ssh2.SFTPWrapper | null = null;
    private isCancelled: boolean = false;

    cancelOperations() {
        this.isCancelled = true;
        if (this.client) {
            this.disconnect();
        }
    }

    private checkCancelled() {
        if (this.isCancelled) {
            throw new Error('Operation cancelled');
        }
    }

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

            this.checkCancelled();

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

            this.checkCancelled();

            // 直接写入/覆盖文件
            this.sftp.writeFile(path, content, (err: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    async deleteFile(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }
    
            this.sftp.unlink(path, (err: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    async mkdir(path: string, recursive: boolean = false): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            if (recursive) {
                // 递归创建目录
                const parts = path.split('/').filter(p => p);
                let current = '';
                const promises = parts.map(part => {
                    current += '/' + part;
                    return new Promise(resolve => {
                        this.sftp!.mkdir(current, err => {
                            // 忽略目录已存在的错误
                            resolve(null);
                        });
                    });
                });
                
                Promise.all(promises)
                    .then(() => resolve())
                    .catch(reject);
            } else {
                this.sftp.mkdir(path, err => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            }
        });
    }
    async rmdir(path: string, recursive: boolean = false): Promise<void> {
        return new Promise(async (resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            if (recursive) {
                try {
                    // 先检查目录是否存在
                    await new Promise((res, rej) => {
                        this.sftp!.stat(path, (err) => {
                            if (err) {
                                rej(new Error(`Directory not found: ${path}`));
                                return;
                            }
                            res(null);
                        });
                    });

                    const files = await this.listFiles(path);
                    
                    for (const file of files) {
                        if (file.filename === '.' || file.filename === '..') {
                            continue;
                        }
                        
                        const fullPath = `${path}/${file.filename}`;
                        if ((file.attrs as any).isDirectory) {
                            await this.rmdir(fullPath, true);
                        } else {
                            await this.deleteFile(fullPath);
                        }
                    }
                    
                    // 最后删除目录本身
                    await new Promise<void>((res, rej) => {
                        this.sftp!.rmdir(path, (err) => {
                            if (err) {
                                rej(new Error(`Failed to remove directory: ${path}, ${err.message}`));
                                return;
                            }
                            res();
                        });
                    });
                    resolve();
                } catch (err) {
                    reject(err);
                }
            } else {
                this.sftp.rmdir(path, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            }
        });
    }
    disconnect() {
        if (this.client) {
            this.client.end();
            this.client = null;
            this.sftp = null;
        }
    }
    async stat(path: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP not connected'));
                return;
            }

            this.sftp.stat(path, (err, stats) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(stats);
            });
        });
    }
} 