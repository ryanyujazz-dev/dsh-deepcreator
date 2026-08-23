// Keep the Typert public face limited to the remote service. An explicit
// wrapper prevents the generator from treating every host-only contract
// re-exported by index.ts as part of the client protocol.
import BrowserHostService from './index.ts'
export default class BrowserRemoteFace extends BrowserHostService {}
