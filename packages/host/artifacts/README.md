# DeepCreator Artifact Reader

Host-owned, read-only workspace file reader for the Workbench Artifact panel. The panel's list is a Client-side session-event projection of the official deliverables mechanism (files the model wrote or edited), so this Host surface owns only the one Typert Remote `read`: it resolves an absolute or workspace-relative path, canonicalizes it, fences it to the Session workspace, and returns utf8 content. Escaping paths, missing files and sessions without a workspace fail with explicit error codes; no business state lives here.
