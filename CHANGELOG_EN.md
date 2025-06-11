# Changelog

English | [Chinese](CHANGELOG.md)

## [1.1.7] - 2024-03-21
- Added: Optimized settings editor interface for better user experience
- Added: Enhanced configuration management for shortcut upload functionality
- Added: Remote file refresh functionality to get the latest content from server
- Added: Refresh button in editor title bar for quick remote file refresh
- Improved: Better sorting logic for remote file lists with directories displayed first
- Improved: Enhanced configuration file migration and management mechanism
- Improved: Enhanced file download logic to ensure getting the latest server content
- Improved: Added file refresh state check to prevent downloading old versions during refresh
- Fixed: Resolved display issues with certain configuration items in settings editor
- Fixed: Improved SFTP connection stability and error handling
- Fixed: Resolved issue with file list not updating immediately after upload

## [1.1.6] - 2025-05-06
- Added: Shortcut upload functionality can now be configured via a switch in the global settings page.
- Improved: Adjusted `Ctrl+S` (Cmd+S) shortcut upload behavior to respond to the new global setting.
## [1.1.5] - 2025-04-08
- Optimize ssh terminal auto connect

## [1.1.4] - 2025-04-07
- Optimize ssh end point connection operation
- Optimize the sorting of remote directories

## [1.1.3] - 2025-03-26
- Fixed the problem that some file extensions cannot be opened when opening remote files

## [1.1.2] - 2025-03-21
- Independent other configurations in the configuration file
- Added a backup operation before replacing or deleting the uploaded file
- Optimized prompts, output in multiple languages

## [1.1.1] - 2025-03-14
- Added readme, changelog English support

## [1.0.9] - 2024-02-24
- Fixed ssh2 module packaging problem

## [1.0.8] - 2024-02-24
- Optimized the description file

## [1.0.7] - 2025-02-24

### Added
- Added ssh connection function
- Added upload directory function
- Fixed packaging problem


## [1.0.6] - 2024-03-14

### Added
- Added multi-language support
- Supported Chinese and English interface
- Automatically switch according to VS Code language settings

## [1.0.5] - 2024-03-14

### Fixed
- Fixed plugin activation problem
- Fixed view provider registration problem
- Optimized setting page button style

## [1.0.4] - 2025-02-24

### Added
- Fixed permission problem causing plugin to fail to start
- Optimized project resource size

## [1.0.3] - 2025-02-24

### Added
- Fixed upload path problem
- Optimized configuration page
- Optimized output log
- Added status bar prompt

## [1.0.2] - 2024-03-14

### Optimized
- Optimized the upload function user experience
- Added local file upload to server function
- Improved status bar prompt information
- Added Chinese interface support

### Fixed
- Fixed the problem that the settings editor could not be opened
- Fixed the problem that the server connection status was not displayed after disconnection

## [1.0.1] - 2024-03-13

### Added
- Supported uploading to multiple servers
- Added server connection status display
- Added file download function
- Added file deletion function

### Optimized
- Optimized server configuration interface
- Improved error prompt information

## [1.0.0] - 2024-03-12

### Initial version
- Basic SFTP function implementation
- Multi-server management
- File browser
- Remote file editing
- File upload/download

### Added
- ✨ Supported multi-server management
- 🔒 Supported password and key authentication
- 📁 Remote file browser
- 📝 File editing and saving
- 🔄 Automatic upload function
- 🖥️ One-click SSH connection
- 📋 Server configuration management interface

### Optimized
- Optimized file transfer performance
- Improved error handling
- Added detailed operation logs
- Supported binary file transfer

### Fixed
- Fixed file path processing problem
- Fixed encoding related problem
- Fixed connection stability problem