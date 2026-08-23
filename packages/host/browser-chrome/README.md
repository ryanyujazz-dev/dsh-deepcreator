# @ryanyujazz/dsh-browser-chrome

System Chrome Provider. A Manifest V3 extension shares only tabs explicitly approved from the extension action, while an authenticated Native Messaging bridge connects Chrome to Browser Runtime without a remote-debugging port.

The provider owns Chrome visibility. DeepCreator presentation is optional and snapshot-only. Installation is explicit through `installChromeIntegration`; it is never performed during normal runtime startup.
