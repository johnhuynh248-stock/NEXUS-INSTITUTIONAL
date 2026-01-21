const Logger = require('../utils/logger');

class DivergenceDetector {
  constructor(flowAnalyzer = null) {
    this.logger = new Logger('divergence-detector');
    this.liveDivergences = new Map(); // symbol -> recent divergences
    this.patternHistory = new Map(); // symbol -> pattern history
    this.liveThresholds = {
      rapidReversal: 1000000, // $1M threshold for rapid reversal
      blockAnomaly: 5000000, // $5M for unusual block size
      flowImbalance: 3.0, // 3:1 ratio for imbalance
      timeWindow: 5 // minutes for live detection
    };
    
    // Connect to flow analyzer if provided
    if (flowAnalyzer) {
      this.connectToFlowAnalyzer(flowAnalyzer);
    }
  }

  connectToFlowAnalyzer(flowAnalyzer) {
    this.flowAnalyzer = flowAnalyzer;
    this.logger.info('Connected to FlowAnalyzer for WebSocket data');
  }

  // Main detection method (historical)
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
    
    // NEW: Check for GAMMA_TRAP pattern
    const gammaTrap = this.detectGammaTrap(flowData);
    if (gammaTrap.confidence > 50) divergences.push(gammaTrap);
    
    return divergences.length > 0 ? divergences : [{
      type: 'NO_CLEAR_DIVERGENCE',
      confidence: 85,
      explanation: 'Institutional flow shows consistent directional bias without major conflicts',
      guidance: 'PATIENCE - Monitor for breakout confirmation'
    }];
  }

  // NEW: Live divergence detection using WebSocket data
  detectLiveDivergences(symbol, liveBlocks, spotPrice, timeframeMinutes = 5) {
    const divergences = [];
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - timeframeMinutes * 60000);
    
    // Filter blocks within timeframe
    const recentBlocks = liveBlocks.filter(block => {
      const blockTime = new Date(block.timestamp);
      return blockTime >= cutoffTime;
    });
    
    if (recentBlocks.length < 2) {
      return [];
    }
    
    // Check for RAPID_FLOW_REVERSAL
    const rapidReversal = this.detectRapidFlowReversal(symbol, recentBlocks);
    if (rapidReversal.confidence > 60) {
      this.liveDivergences.set(symbol, {
        ...rapidReversal,
        timestamp: now,
        blocks: recentBlocks
      });
      divergences.push(rapidReversal);
    }
    
    // Check for BLOCK_SIZE_ANOMALY
    const blockAnomaly = this.detectBlockSizeAnomaly(symbol, recentBlocks);
    if (blockAnomaly.confidence > 60) {
      this.liveDivergences.set(symbol, {
        ...blockAnomaly,
        timestamp: now,
        blocks: recentBlocks
      });
      divergences.push(blockAnomaly);
    }
    
    // Check for FLOW_IMBALANCE
    const flowImbalance = this.detectFlowImbalance(symbol, recentBlocks);
    if (flowImbalance.confidence > 60) {
      divergences.push(flowImbalance);
    }
    
    // Check for DEALER_HEDGING_PRESSURE
    const dealerPressure = this.detectDealerHedgingPressure(recentBlocks, spotPrice);
    if (dealerPressure.confidence > 60) {
      divergences.push(dealerPressure);
    }
    
    return divergences;
  }

  // NEW: Get live divergence status for a symbol
  getLiveDivergenceStatus(symbol) {
    const divergences = this.liveDivergences.get(symbol);
    if (!divergences) {
      return {
        hasLiveDivergence: false,
        lastCheck: null,
        message: 'No live divergences detected'
      };
    }
    
    return {
      hasLiveDivergence: true,
      type: divergences.type,
      confidence: divergences.confidence,
      timestamp: divergences.timestamp,
      explanation: divergences.explanation,
      guidance: divergences.guidance
    };
  }

  // NEW: Live detection methods
  detectRapidFlowReversal(symbol, recentBlocks) {
    if (recentBlocks.length < 3) {
      return { type: 'RAPID_FLOW_REVERSAL', confidence: 0, explanation: '', guidance: '' };
    }
    
    // Group blocks by minute
    const blocksByMinute = {};
    recentBlocks.forEach(block => {
      const minute = Math.floor(new Date(block.timestamp).getTime() / 60000);
      if (!blocksByMinute[minute]) {
        blocksByMinute[minute] = { calls: 0, puts: 0 };
      }
      if (block.option_type === 'CALL') {
        blocksByMinute[minute].calls += block.notional || 0;
      } else {
        blocksByMinute[minute].puts += block.notional || 0;
      }
    });
    
    const minutes = Object.keys(blocksByMinute).sort();
    if (minutes.length < 3) {
      return { type: 'RAPID_FLOW_REVERSAL', confidence: 0, explanation: '', guidance: '' };
    }
    
    // Check for reversal pattern
    let reversals = 0;
    for (let i = 1; i < minutes.length - 1; i++) {
      const prev = blocksByMinute[minutes[i-1]];
      const curr = blocksByMinute[minutes[i]];
      const next = blocksByMinute[minutes[i+1]];
      
      const prevNet = prev.calls - prev.puts;
      const currNet = curr.calls - curr.puts;
      const nextNet = next.calls - next.puts;
      
      if (Math.sign(prevNet) !== Math.sign(currNet) && Math.sign(currNet) !== Math.sign(nextNet)) {
        if (Math.abs(prevNet) > this.liveThresholds.rapidReversal && 
            Math.abs(currNet) > this.liveThresholds.rapidReversal &&
            Math.abs(nextNet) > this.liveThresholds.rapidReversal) {
          reversals++;
        }
      }
    }
    
    const confidence = Math.min(reversals * 30, 90);
    
    if (confidence > 60) {
      return {
        type: 'RAPID_FLOW_REVERSAL',
        confidence,
        explanation: `Detected ${reversals} rapid flow reversal(s) in last ${this.liveThresholds.timeWindow} minutes. Institutional sentiment shifting rapidly.`,
        guidance: 'STAY FLAT - Avoid directional bets during rapid sentiment shifts'
      };
    }
    
    return { type: 'RAPID_FLOW_REVERSAL', confidence: 0, explanation: '', guidance: '' };
  }

  detectBlockSizeAnomaly(symbol, recentBlocks) {
    if (recentBlocks.length === 0) {
      return { type: 'BLOCK_SIZE_ANOMALY', confidence: 0, explanation: '', guidance: '' };
    }
    
    // Calculate average block size
    const totalNotional = recentBlocks.reduce((sum, block) => sum + (block.notional || 0), 0);
    const avgSize = totalNotional / recentBlocks.length;
    
    // Find largest block
    const largestBlock = recentBlocks.reduce((max, block) => 
      (block.notional || 0) > (max.notional || 0) ? block : max, recentBlocks[0]
    );
    
    const anomalyRatio = largestBlock.notional / avgSize;
    const confidence = anomalyRatio > 5 ? Math.min(anomalyRatio * 15, 95) : 0;
    
    if (confidence > 60 && largestBlock.notional > this.liveThresholds.blockAnomaly) {
      const type = largestBlock.option_type === 'CALL' ? 'C' : 'P';
      return {
        type: 'BLOCK_SIZE_ANOMALY',
        confidence,
        explanation: `$${this.formatNumber(largestBlock.notional)} ${largestBlock.strike}${type} block is ${anomalyRatio.toFixed(1)}x larger than average. Unusually large institutional print detected.`,
        guidance: 'MONITOR CLOSELY - Large block may indicate institutional rebalancing or hedging activity'
      };
    }
    
    return { type: 'BLOCK_SIZE_ANOMALY', confidence: 0, explanation: '', guidance: '' };
  }

  detectFlowImbalance(symbol, recentBlocks) {
    const calls = recentBlocks.filter(b => b.option_type === 'CALL');
    const puts = recentBlocks.filter(b => b.option_type === 'PUT');
    
    const callNotional = calls.reduce((sum, b) => sum + (b.notional || 0), 0);
    const putNotional = puts.reduce((sum, b) => sum + (b.notional || 0), 0);
    
    const totalNotional = callNotional + putNotional;
    if (totalNotional === 0) {
      return { type: 'FLOW_IMBALANCE', confidence: 0, explanation: '', guidance: '' };
    }
    
    const ratio = callNotional > putNotional ? 
      callNotional / putNotional : 
      putNotional / callNotional;
    
    const isCallDominant = callNotional > putNotional;
    const percentDominance = (Math.max(callNotional, putNotional) / totalNotional * 100).toFixed(1);
    
    const confidence = ratio > this.liveThresholds.flowImbalance ? 
      Math.min((ratio / this.liveThresholds.flowImbalance) * 50, 90) : 0;
    
    if (confidence > 60) {
      return {
        type: 'FLOW_IMBALANCE',
        confidence,
        explanation: `Extreme ${isCallDominant ? 'call' : 'put'} dominance: ${percentDominance}% of flow (${ratio.toFixed(1)}:1 ratio) in last ${this.liveThresholds.timeWindow} minutes`,
        guidance: isCallDominant ? 
          'CONSIDER HEDGES - Extreme call flow may signal overbought conditions' :
          'LOOK FOR REVERSAL - Extreme put flow may indicate oversold bounce opportunity'
      };
    }
    
    return { type: 'FLOW_IMBALANCE', confidence: 0, explanation: '', guidance: '' };
  }

  detectDealerHedgingPressure(recentBlocks, spotPrice) {
    // Analyze blocks near current price for dealer impact
    const nearStrikeBlocks = recentBlocks.filter(block => {
      if (!block.strike) return false;
      const distancePercent = Math.abs((block.strike - spotPrice) / spotPrice * 100);
      return distancePercent < 2; // Within 2% of spot
    });
    
    if (nearStrikeBlocks.length === 0) {
      return { type: 'DEALER_HEDGING_PRESSURE', confidence: 0, explanation: '', guidance: '' };
    }
    
    const totalNotional = nearStrikeBlocks.reduce((sum, b) => sum + (b.notional || 0), 0);
    
    // Estimate dealer delta hedge required
    const estimatedDeltaHedge = nearStrikeBlocks.reduce((sum, block) => {
      let delta = 0.5; // Approximate ATM delta
      if (block.option_type === 'PUT') delta = -0.5;
      return sum + (block.notional || 0) * delta;
    }, 0);
    
    const confidence = Math.min((totalNotional / 1000000) * 10, 85);
    
    if (confidence > 60) {
      const direction = estimatedDeltaHedge > 0 ? 'BUYING' : 'SELLING';
      return {
        type: 'DEALER_HEDGING_PRESSURE',
        confidence,
        explanation: `$${this.formatNumber(Math.abs(estimatedDeltaHedge))} estimated dealer delta hedge required. Dealers will be ${direction} underlying to hedge recent ATM flow.`,
        guidance: direction === 'BUYING' ? 
          'FOLLOW DEALERS - Expect upward pressure as dealers hedge' :
          'CAUTION - Downward pressure expected from dealer hedging'
      };
    }
    
    return { type: 'DEALER_HEDGING_PRESSURE', confidence: 0, explanation: '', guidance: '' };
  }

  // NEW: Gamma trap detection
  detectGammaTrap(flowData) {
    // Look for heavy call buying just above resistance and put buying just below support
    const atmRange = 0.02; // ±2%
    
    const callTraps = flowData.filter(f => 
      f.option_type === 'CALL' && 
      f.side === 'BUY' &&
      f.distance_percent > 1 && 
      f.distance_percent < 3 // Just above resistance
    );
    
    const putTraps = flowData.filter(f => 
      f.option_type === 'PUT' && 
      f.side === 'BUY' &&
      f.distance_percent < -1 && 
      f.distance_percent > -3 // Just below support
    );
    
    const callTrapNotional = callTraps.reduce((sum, f) => sum + f.notional, 0);
    const putTrapNotional = putTraps.reduce((sum, f) => sum + f.notional, 0);
    
    const confidence = (callTrapNotional > 1000000 || putTrapNotional > 1000000) ?
      Math.min((callTrapNotional + putTrapNotional) / 2000000 * 70, 85) : 0;
    
    if (confidence > 50) {
      return {
        type: 'GAMMA_TRAP',
        confidence,
        explanation: `Institutions accumulating ${callTrapNotional > putTrapNotional ? 'calls above resistance' : 'puts below support'} ($${this.formatNumber(Math.max(callTrapNotional, putTrapNotional))}) creating gamma traps`,
        guidance: 'AVOID BREAKOUT FADES - Gamma positioning suggests potential for sharp moves if levels break'
      };
    }
    
    return { type: 'GAMMA_TRAP', confidence: 0, explanation: '', guidance: '' };
  }

  // Original detection methods (kept for compatibility)
  detectShortTermPopLongFade(hourlyBreakdown) {
    const { hourly } = hourlyBreakdown;
    
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
