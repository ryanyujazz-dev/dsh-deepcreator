# DeepCreator Artifact Registry

Host-owned, event-sourced artifact metadata for Workbench. Metadata is folded from the owning Session log; large content remains at a workspace path or another locator. `list` and `read` are generated Typert Remote methods. Workspace-path reads are canonicalized and fenced to the Session workspace.
