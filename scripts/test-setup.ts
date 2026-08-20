/** Browser APIs used by image-preview orchestration but omitted by jsdom. */
if (URL.createObjectURL === undefined) {
  URL.createObjectURL = () => 'blob:deepcreator-test'
}
if (URL.revokeObjectURL === undefined) {
  URL.revokeObjectURL = () => {}
}

/** lottie-web performs a tiny canvas feature probe even when using its SVG renderer. */
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      fillStyle: '',
      fillRect: () => {},
    }),
  })
}
