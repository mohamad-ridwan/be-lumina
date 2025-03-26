function generateTokenClient() {
    const token1 = Math.floor(Math.random() * 9)
    const token2 = Math.floor(Math.random() * 9)
    const token3 = Math.floor(Math.random() * 9)
    const token4 = Math.floor(Math.random() * 9)
    const tokenResult = `${token1}${token2}${token3}${token4}`
    return tokenResult
}

module.exports = { generateTokenClient }