const Logger = require('../utils/logger');

class DivergenceDetector {
  constructor() {
    this.logger = new Logger('divergence-detector');
  }

  detectDivergences(flowData, hourlyBreakdown) {
    const divergences = [];
    
    // Check for SHORT_TERM_POP_LONG_FADE
    const popFade = this.detectShortTermPopLongFade(hourlyBreakdown);
    if (popFade.confidence > 50) divergences.push(popFade);
    
    // Check for HEDGE_THEN_CONVICTION
    const hedgeConviction = this.detectHedgeThenConviction(flowData);
    if (hedgeConviction.confidence > 50) divergences.push(hedgeConviction);
    
    // Check for DEALER_PIN_RISK
    const pinRisk = this.detectDealerPinRisk(flowData);
    if (pinRisk.confidence > 50) divergences.push(pinRisk);
    
    // Check for VOL_CRUSH_POSITIONING
    const volCrush = this.detectVolCrushPositioning(flowData);
    if (volCrush.confidence > 50) divergences.push(volCrush);
    
    return divergences.length > 0 ? divergences : [{
      type: 'NO_CLEAR_DIVERGENCE',
      confidence: 85,
      explanation: 'Institutional flow shows consistent directional bias without major conflicts',
      guidance: 'PATIENCE - Monitor for breakout confirmation'
    }];
  }

  detectShortTermPopLongFade(hourlyBreakdown) {
    const { hourly } = hourlyBreakdown;
    
    // Look for strong morning buying followed by afternoon selling
    const morningHours = [9, 10, 11];
    const afternoonHours = [13, 14, 15];
    
    let morningNet = 0;
    let afternoonNet = 0;
    
    morningHours.forEach(hour => {
      if (hourly[hour]) morningNet += hourly[hour].netFlow;
    });
    
    afternoonHours.forEach(hour => {
      if (hourly[hour]) afternoonNet += hourly[hour].netFlow;
    });
    
    const confidence = this.calculateDivergenceConfidence(morningNet, afternoonNet);
    
    if (confidence > 50 && morningNet > 0 && afternoonNet < 0) {
      return {
        type: 'SHORT_TERM_POP_LONG_FADE',
        confidence: Math.min(confidence, 95),
        explanation: `Strong morning buying ($${this.formatNumber(morningNet)}) followed by afternoon selling ($${this.formatNumber(Math.abs(afternoonNet))}) suggests institutions taking profits into strength`,
        guidance: 'SCALP - Fade morning strength, sell into afternoon rallies'
      };
    }
    
    return { type: 'SHORT_TERM_POP_LONG_FADE', confidence: 0, explanation: '', guidance: '' };
  }

  detectHedgeThenConviction(flowData) {
    // Look for early hedging (puts) followed by conviction (calls)
    const earlyFlow = flowData.filter(f => {
      const hour = f.timestamp.getHours();
      return hour >= 9 && hour <= 11;
    });
    
    const lateFlow = flowData.filter(f => {
      const hour = f.timestamp.getHours();
      return hour >= 13 && hour <= 15;
    });
    
    const earlyPuts = earlyFlow.filter(f => f.option_type === 'PUT' && f.side === 'BUY');
    const lateCalls = lateFlow.filter(f => f.option_type === 'CALL' && f.side === 'BUY');
    
    const earlyHedgeValue = earlyPuts.reduce((sum, f) => sum + f.notional, 0);
    const lateConvictionValue = lateCalls.reduce((sum, f) => sum + f.notional, 0);
    
    const confidence = earlyHedgeValue > 1000000 && lateConvictionValue > earlyHedgeValue * 1.5
      ? Math.min((lateConvictionValue / earlyHedgeValue) * 30, 90)
      : 0;
    
    if (confidence > 50) {
      return {
        type: 'HEDGE_THEN_CONVICTION',
        confidence,
        explanation: `Institutions established $${this.formatNumber(earlyHedgeValue)} in protective puts early, then deployed $${this.formatNumber(lateConvictionValue)} in call buying suggesting underlying conviction`,
        guidance: 'TRIM early hedges on strength, add to core position on pullbacks'
      };
    }
    
    return { type: 'HEDGE_THEN_CONVICTION', confidence: 0, explanation: '', guidance: '' };
  }

  detectDealerPinRisk(flowData) {
    // Look for heavy put selling near current price
    const atmPuts = flowData.filter(f => 
      f.option_type === 'PUT' && 
      f.side === 'SELL' && 
      Math.abs(f.distance_percent) < 5
    );
    
    const atmPutNotional = atmPuts.reduce((sum, f) => sum + f.notional, 0);
    const totalPutFlow = flowData.filter(f => f.option_type === 'PUT').reduce((sum, f) => sum + f.notional, 0);
    
    const putSellRatio = totalPutFlow > 0 ? atmPutNotional / totalPutFlow : 0;
    
    const confidence = putSellRatio > 0.6 && atmPutNotional > 500000 
      ? Math.min(putSellRatio * 100, 85)
      : 0;
    
    if (confidence > 50) {
      return {
        type: 'DEALER_PIN_RISK',
        confidence,
        explanation: `$${this.formatNumber(atmPutNotional)} in ATM put selling (${(putSellRatio * 100).toFixed(1)}% of total put flow) creates dealer pin risk near current price`,
        guidance: 'PATIENCE - Expect chop as dealers hedge gamma, avoid new positions until pin clears'
      };
    }
    
    return { type: 'DEALER_PIN_RISK', confidence: 0, explanation: '', guidance: '' };
  }

  detectVolCrushPositioning(flowData) {
    // Look for call selling and put selling (strangle selling)
    const callSelling = flowData.filter(f => 
      f.option_type === 'CALL' && f.side === 'SELL'
    );
    
    const putSelling = flowData.filter(f => 
      f.option_type === 'PUT' && f.side === 'SELL'
    );
    
    const callSellNotional = callSelling.reduce((sum, f) => sum + f.notional, 0);
    const putSellNotional = putSelling.reduce((sum, f) => sum + f.notional, 0);
    
    const totalCallFlow = flowData.filter(f => f.option_type === 'CALL').reduce((sum, f) => sum + f.notional, 0);
    const totalPutFlow = flowData.filter(f => f.option_type === 'PUT').reduce((sum, f) => sum + f.notional, 0);
    
    const callSellRatio = totalCallFlow > 0 ? callSellNotional / totalCallFlow : 0;
    const putSellRatio = totalPutFlow > 0 ? putSellNotional / totalPutFlow : 0;
    
    const confidence = callSellRatio > 0.5 && putSellRatio > 0.5 
      ? Math.min((callSellRatio + putSellRatio) * 50, 90)
      : 0;
    
    if (confidence > 50) {
      return {
        type: 'VOL_CRUSH_POSITIONING',
        confidence,
        explanation: `Simultaneous call selling (${(callSellRatio * 100).toFixed(1)}% of calls) and put selling (${(putSellRatio * 100).toFixed(1)}% of puts) indicates institutions positioning for volatility compression`,
        guidance: 'SCALP - Sell premium on both sides, target range-bound price action'
      };
    }
    
    return { type: 'VOL_CRUSH_POSITIONING', confidence: 0, explanation: '', guidance: '' };
  }

  calculateDivergenceConfidence(morningNet, afternoonNet) {
    const totalFlow = Math.abs(morningNet) + Math.abs(afternoonNet);
    if (totalFlow === 0) return 0;
    
    const divergenceRatio = Math.abs(morningNet - afternoonNet) / totalFlow;
    return Math.min(divergenceRatio * 100, 95);
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(0);
  }
}

module.exports = DivergenceDetector;
