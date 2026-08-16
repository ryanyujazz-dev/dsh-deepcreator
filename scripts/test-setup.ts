/** Browser APIs used by image-preview orchestration but omitted by jsdom. */
if (URL.createObjectURL === undefined) {
  URL.createObjectURL = () => 'blob:deepcreator-test'
}
if (URL.revokeObjectURL === undefined) {
  URL.revokeObjectURL = () => {}
}
