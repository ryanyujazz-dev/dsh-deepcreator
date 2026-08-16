# DeepCreator Desktop

DeepCreator Desktop owns one sandboxed Electron window and one official `dsh` child process running under system Node. The child starts `--profile deepcreator --port 0`; the window accepts navigation only to the exact loopback origin printed after the Cordis tree settles. Session titles retain their text while the native window suffix is branded `DeepCreator`.

Run `pnpm run profile:migrate` once, then use `pnpm run dev:desktop` from the repository root.

The renderer keeps `sandbox`, `contextIsolation`, and `webSecurity` enabled and does not enable Node integration or a preload bridge. HTTP(S) popups open in the system browser; all other new-window requests are denied.
