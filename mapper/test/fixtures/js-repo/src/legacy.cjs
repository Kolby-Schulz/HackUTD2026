// CommonJS exports are not mapped (only ES module exports are).
function legacyAdd(a, b) {
  return a + b;
}
module.exports = { legacyAdd };
