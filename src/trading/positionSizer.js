class PositionSizer {
    static calculateUnits(balance, riskPercent, stopPips, pipSize) {
        const riskAmt = balance * riskPercent;
        return Math.floor(riskAmt / (stopPips * pipSize));
    }
}

module.exports = PositionSizer;