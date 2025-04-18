# SFTP Tools

[English](README_EN.md) | 简体中文

SFTP Tools 是一个用于在 VS Code 中管理远程服务器文件的扩展。

安装地址：https://marketplace.visualstudio.com/items?itemName=caoayu.sftp-tools

## 功能特点

- 💕 可视化配置,支持密钥连接
- 📁 服务器文件浏览器
- 🔄 文件上传/下载（支持二进制文件，比如zip,rar等）
- 🔌 多服务器管理
- 🚀 快速连接/断开
- 📝 直接编辑远程文件
- 🔄 自动同步更改
- 🎯 简单直观的界面
- 👾 一键连接 ssh 终端
- 🤗 多语言支持
- 😊 配置分离
- 😊 支持备份

![alt text](./media/images/setting1.png)
![alt text](./media/images/setting2.png)
![alt text](./media/images/use1.png)
![alt text](./media/images/use2.png)
![alt text](./media/images/use3.png)

## 使用方法

1. 添加服务器
   - 点击 SFTP 图标打开侧边栏
   - 点击 servce 服务面板 设置 按钮进入设置页面,添加新服务器
   - 输入服务器信息（名称、主机、端口、用户名、密码,本地工作区目录等）

2. 连接服务器
   - 在服务器列表中点击服务器名称连接
   - 连接成功后可以浏览远程文件

3. 文件操作
   - 上传：右键本地文件选择上传选项
   - 下载：右键远程文件选择下载
   - 删除：右键远程文件选择删除
   - 编辑：双击远程文件直接编辑
4. 一键连接 ssh 终端
   - 点击服务器列表中的 ssh 按钮,连接 ssh 终端
   - 连接成功后可以输入命令操作

## 配置说明
1. 添加服务器,配置 hosts port username password 
2. 可删除,编辑服务器
3. 保存后刷新服务器列表

## 注意事项

- 请确保服务器配置信息正确
- 建议使用 SSH 密钥认证以提高安全性
- 首次连接可能需要接受服务器指纹

## 问题反馈

如果您遇到任何问题或有功能建议，欢迎在 [GitHub Issues](https://github.com/ayuayue/sftp-tools/issues) 提出。

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。

## 支持作者

如果觉得这个扩展对你有帮助，可以请作者喝杯咖啡，支持作者继续开发。

<img src="./media/alipay.png" alt="支付宝" width="200">

<img src="./media/wechat_pay.png" alt="微信" width="200">