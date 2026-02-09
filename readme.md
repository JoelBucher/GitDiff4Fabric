# GitDiff4Fabric

GitDiff4Fabric is a VS Code extension for viewing and applying Git-backed changes from Fabric workspaces into local repositories.

## Features

- Displays active changes to a Fabric workspace.
- Pulls workspace files into the local Git-tracked directory to show diffs.
- Provides commands for workspace selection, refreshing, and restoring HEAD.

## Commands

- `Select Workspace`: Choose a Fabric workspace.
- `Download Workspace`: Pull workspace files into the local directory.
- `Checkout Fabric Workspace HEAD`: Sync local Git- with Fabric workspace State.
- `Refresh`: Update workspace and status views.

## Usage

1. Open a Git repository linked to a Fabric workspace.
2. Use the `Workspaces` view or Command Palette to select linked workspace.
3. View file changes in `Fabric Git Status`.
4. Pull workspace files to see diffs in the Source Control view.

**Note:** Downloading workspace changes overwrites local files. Commit or stash changes before pulling.

## Development

1. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
2. Launch the extension in the Extension Development Host (F5 in VS Code).

## License

MIT — see `LICENSE`.
