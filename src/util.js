function assert(condition) {
    if (!condition) throw new Error('assert failed');
}

module.exports = {
    assert,
};
