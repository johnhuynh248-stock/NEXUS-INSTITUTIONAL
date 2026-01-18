const config = require('../config');
const Logger = require('../utils/logger');

class TierAnalyzer {
  constructor() {
    this.rules = config.rules;
    this.logger = new Logger('tier-analyzer');
  }

  analyzeTiers(flowData) {
    // STRICT RULE: No DTE mixing
    const tier1 = this.filterTier(flowData, 'tier1');
    const tier2 = this.filterTier(flowData, 'tier2');
    
    // Validate no overlap
    this.validateNoOverlap(tier1, tier2);
    
    return {
      tier1: this.analyzeTierData(tier1, 'TIER-1 (Urgent | 0-3 DTE)'),
      tier2: this.analyzeTierData(tier2, 'TIER-2 (Patient | 3-14 DTE)')
    };
  }

  filterTier(flowData, tierName) {
    const { min, max } = this.rules.dteTiers[tierName];
    
    return flowData.filter(flow => {
      const dte = flow.dte || 0;
      
      if (tierName === 'tier1') {
        return dte >= min && dte <= max;
      } else if (tierName === 'tier2') {
        return dte > min && dte <= max; // >3 to avoid overlap
      }
      
      return false;
    });
  }

  validateNoOverlap(tier1, tier2) {
    const tier1DtEs = new Set(tier1.map(f => f.dte));
    const tier2DtEs = new Set(tier2.map(f => f.dte));
    
    const overlap = [...tier1DtEs].filter(dte => tier2DtEs.has(dte));
    
    if (overlap.length > 0) {
      this.logger.warn(`DTE overlap detected: ${overlap.join(', ')}`);
      throw new Error('DTE TIER OVERLAP DETECTED - Violates hard rule');
    }
  }

  analyzeTierData(tierFlow, tierLabel) {
    if (tierFlow.length === 0) {
      return {
        label: tierLabel,
        calls: { notional: 0, prints: 0, realDelta: 0, avgDte: 0, avgSize: 0 },
        puts: { notional: 0, prints: 0, realDelta: 0, avgDte: 0, avgSize: 0 },
        ratio: { notional: 'N/A', realDelta: 'N/A' },
        netExposure: 0,
        takeaway: 'No institutional flow detected'
      };
    }

    // Separate calls and puts
    const calls = tierFlow.filter(f => f.option_type === 'CALL');
    const puts = tierFlow.filter(f => f.option_type === 'PUT');

    // Calculate call metrics
    const callNotional = calls.reduce((sum, f) => sum + f.notional, 0);
    const callPrints = calls.length;
    const callRealDelta = calls.reduce((sum, f) => sum + f.delta_exposure, 0);
    const callAvgDte = calls.length > 0 
      ? calls.reduce((sum, f) => sum + (f.dte || 0), 0) / calls.length 
      : 0;
    const callAvgSize = calls.length > 0 ? callNotional / calls.length : 0;

    // Calculate put metrics
    const putNotional = puts.reduce((sum, f) => sum + f.notional, 0);
    const putPrints = puts.length;
    const putRealDelta = puts.reduce((sum, f) => sum + f.delta_exposure, 0);
    const putAvgDte = puts.length > 0 
      ? puts.reduce((sum, f) => sum + (f.dte || 0), 0) / puts.length 
      : 0;
    const putAvgSize = puts.length > 0 ? putNotional / puts.length : 0;

    // Calculate ratios
    const notionalRatio = putNotional > 0 
      ? (callNotional / putNotional).toFixed(2) 
      : callNotional > 0 ? '∞' : '0';
    
    const realDeltaRatio = Math.abs(putRealDelta) > 0 
      ? (callRealDelta / Math.abs(putRealDelta)).toFixed(2)
      : callRealDelta > 0 ? '∞' : '0';

    // Net exposure
    const netExposure = callNotional - putNotional;

    // Generate takeaway
    const takeaway = this.generateTierTakeaway(
      callNotional, 
      putNotional, 
      callRealDelta, 
      putRealDelta,
      tierLabel
    );

    return {
      label: tierLabel,
      calls: {
        notional: callNotional,
        prints: callPrints,
        realDelta: callRealDelta,
        avgDte: callAvgDte.toFixed(1),
        avgSize: callAvgSize
      },
      puts: {
        notional: putNotional,
        prints: putPrints,
        realDelta: putRealDelta,
        avgDte: putAvgDte.toFixed(1),
        avgSize: putAvgSize
      },
      ratio: {
        notional: notionalRatio,
        realDelta: realDeltaRatio,
        notionalBullish: parseFloat(notionalRatio) > 1.2,
        realDeltaBullish: parseFloat(realDeltaRatio) > 1.2
      },
      netExposure,
      takeaway
    };
  }

  generateTierTakeaway(callNotional, putNotional, callDelta, putDelta, tierLabel) {
    const total = callNotional + Math.abs(putNotional);
    if (total === 0) return 'No flow detected';
    
    const callPercent = (callNotional / total * 100).toFixed(1);
    const putPercent = (Math.abs(putNotional) / total * 100).toFixed(1);
    
    const netDelta = callDelta + putDelta;
    
    if (callPercent > 60 && netDelta > 0) {
      return `${tierLabel} flow is ${callPercent}% call-heavy speculation`;
    } else if (putPercent > 60 && netDelta < 0) {
      return `${tierLabel} flow is ${putPercent}% put-heavy hedging`;
    } else if (Math.abs(callPercent - putPercent) < 20) {
      return `${tierLabel} shows balanced flow with slight ${callPercent > putPercent ? 'call' : 'put'} bias`;
    } else if (callPercent > putPercent && netDelta < 0) {
      return `${tierLabel} shows call selling/put buying (volatility crush positioning)`;
    } else if (putPercent > callPercent && netDelta > 0) {
      return `${tierLabel} shows put selling/call buying (pin risk management)`;
    } else {
      return `${tierLabel} shows mixed institutional positioning`;
    }
  }
}

module.exports = TierAnalyzer;
