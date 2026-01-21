const config = require('../config');
const Logger = require('../utils/logger');

class TierAnalyzer {
  constructor() {
    this.rules = config.rules;
    this.logger = new Logger('tier-analyzer');
  }

  analyzeTiers(flowData, spotPrice, isLiveData = false) {
    // Add WebSocket/live data context
    this.currentContext = {
      isLiveData,
      analysisTime: new Date(),
      hasRecentFlow: this.hasRecentFlow(flowData, isLiveData)
    };

    // STRICT RULE: No DTE mixing
    const tier1Flow = this.filterTier(flowData, 'tier1');
    const tier2Flow = this.filterTier(flowData, 'tier2');
    
    // Validate no overlap
    this.validateNoOverlap(tier1Flow, tier2Flow);
    
    const tier1Analysis = this.analyzeTierData(tier1Flow, 'TIER-1 (Urgent | 0-3 DTE)', spotPrice, isLiveData);
    const tier2Analysis = this.analyzeTierData(tier2Flow, 'TIER-2 (Patient | 3-14 DTE)', spotPrice, isLiveData);
    
    // Apply hierarchy rules with WebSocket context
    const hierarchy = this.applyHierarchyRules(tier1Analysis, tier2Analysis, flowData, spotPrice, isLiveData);
    
    return {
      tier1: tier1Analysis,
      tier2: tier2Analysis,
      hierarchy: hierarchy,
      decision: this.makeTierDecision(tier1Analysis, tier2Analysis, hierarchy),
      context: this.currentContext
    };
  }

  hasRecentFlow(flowData, isLiveData) {
    if (!isLiveData || !flowData || flowData.length === 0) return false;
    
    const now = new Date();
    const recentThreshold = 5 * 60 * 1000; // 5 minutes
    
    return flowData.some(flow => {
      const flowTime = new Date(flow.timestamp || flow.timestamp_original || now);
      return (now - flowTime) < recentThreshold;
    });
  }

  filterTier(flowData, tierName) {
    const { min, max } = this.rules.dteTiers[tierName];
    
    return flowData.filter(flow => {
      // Handle both calculated DTE and raw expiration dates
      let dte = flow.dte;
      
      // If DTE not provided, calculate it from expiration date
      if (dte === undefined || dte === null) {
        dte = this.calculateDTEFromExpiration(flow.expiration, flow.timestamp);
      }
      
      if (tierName === 'tier1') {
        return dte >= min && dte <= max;
      } else if (tierName === 'tier2') {
        return dte > min && dte <= max; // >3 to avoid overlap
      }
      
      return false;
    });
  }

  calculateDTEFromExpiration(expirationDate, flowDate = new Date()) {
    if (!expirationDate) return 0;
    
    try {
      const exp = new Date(expirationDate);
      const flow = new Date(flowDate);
      const diffTime = exp - flow;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    } catch (error) {
      return 0;
    }
  }

  validateNoOverlap(tier1, tier2) {
    // Only validate if we have data in both tiers
    if (tier1.length === 0 || tier2.length === 0) return;
    
    const tier1DtEs = new Set();
    const tier2DtEs = new Set();
    
    tier1.forEach(f => {
      const dte = f.dte || this.calculateDTEFromExpiration(f.expiration, f.timestamp);
      tier1DtEs.add(dte);
    });
    
    tier2.forEach(f => {
      const dte = f.dte || this.calculateDTEFromExpiration(f.expiration, f.timestamp);
      tier2DtEs.add(dte);
    });
    
    const overlap = [...tier1DtEs].filter(dte => tier2DtEs.has(dte));
    
    if (overlap.length > 0) {
      this.logger.warn(`DTE overlap detected: ${overlap.join(', ')}`);
      // Don't throw error for WebSocket data - just warn
      if (!this.currentContext.isLiveData) {
        throw new Error('DTE TIER OVERLAP DETECTED - Violates hard rule');
      }
    }
  }

  analyzeTierData(tierFlow, tierLabel, spotPrice, isLiveData) {
    if (tierFlow.length === 0) {
      return {
        label: tierLabel,
        calls: { notional: 0, prints: 0, realDelta: 0, avgDte: 0, avgSize: 0 },
        puts: { notional: 0, prints: 0, realDelta: 0, avgDte: 0, avgSize: 0 },
        ratio: { notional: 'N/A', realDelta: 'N/A' },
        netExposure: 0,
        directionalSignal: 'NEUTRAL',
        takeaway: 'No institutional flow detected',
        hasClearSignal: false,
        isDominant: false,
        atmImbalance: false,
        repeatStrikes: false,
        aggressiveExecution: false,
        nearSpot: false,
        isLiveData: isLiveData,
        flowAge: this.getFlowAge(tierFlow)
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
      ? calls.reduce((sum, f) => sum + (f.dte || this.calculateDTEFromExpiration(f.expiration, f.timestamp)), 0) / calls.length 
      : 0;
    const callAvgSize = calls.length > 0 ? callNotional / calls.length : 0;

    // Calculate put metrics
    const putNotional = puts.reduce((sum, f) => sum + f.notional, 0);
    const putPrints = puts.length;
    const putRealDelta = puts.reduce((sum, f) => sum + f.delta_exposure, 0);
    const putAvgDte = puts.length > 0 
      ? puts.reduce((sum, f) => sum + (f.dte || this.calculateDTEFromExpiration(f.expiration, f.timestamp)), 0) / puts.length 
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
    const totalFlow = callNotional + Math.abs(putNotional);
    
    // Determine directional signal
    let directionalSignal = 'NEUTRAL';
    let signalStrength = 0;
    
    if (callNotional > putNotional * 1.5) {
      directionalSignal = 'BULLISH';
      signalStrength = (callNotional / totalFlow) * 100;
    } else if (putNotional > callNotional * 1.5) {
      directionalSignal = 'BEARISH';
      signalStrength = (Math.abs(putNotional) / totalFlow) * 100;
    }

    // Check for Tier-1 specific signals
    const isTier1 = tierLabel.includes('TIER-1');
    let hasClearSignal = false;
    let atmImbalance = false;
    let repeatStrikes = false;
    let aggressiveExecution = false;
    let nearSpot = false;
    
    if (isTier1 && tierFlow.length > 0) {
      // 1. Check for ATM imbalance (±2%)
      const atmRange = spotPrice * 0.02;
      const atmFlow = tierFlow.filter(f => Math.abs(f.strike - spotPrice) <= atmRange);
      const atmCallNotional = atmFlow.filter(f => f.option_type === 'CALL').reduce((sum, f) => sum + f.notional, 0);
      const atmPutNotional = atmFlow.filter(f => f.option_type === 'PUT').reduce((sum, f) => sum + f.notional, 0);
      atmImbalance = Math.abs(atmCallNotional - atmPutNotional) > Math.max(atmCallNotional, atmPutNotional) * 0.5;
      
      // 2. Check for repeat strikes
      const strikeCounts = {};
      tierFlow.forEach(f => {
        strikeCounts[f.strike] = (strikeCounts[f.strike] || 0) + 1;
      });
      repeatStrikes = Object.values(strikeCounts).some(count => count >= 3);
      
      // 3. Check for aggressive execution - enhanced for WebSocket
      const recentFlows = tierFlow.filter(f => {
        if (!f.timestamp) return false;
        const flowTime = new Date(f.timestamp);
        const hour = flowTime.getHours();
        const now = new Date();
        const minutesAgo = (now - flowTime) / (1000 * 60);
        
        // For live data, use recent timeframe
        if (isLiveData) {
          return minutesAgo <= 30; // Last 30 minutes
        }
        return hour >= 13 && hour <= 16; // Last 3 hours for historical
      });
      
      aggressiveExecution = recentFlows.length > 0 && 
        recentFlows.some(f => f.notional >= 1000000);
      
      // 4. Check for near spot clustering
      const nearSpotFlow = tierFlow.filter(f => Math.abs(f.distance_percent) <= 1);
      nearSpot = nearSpotFlow.length >= tierFlow.length * 0.3;
      
      // Determine if Tier-1 has clear signal
      hasClearSignal = atmImbalance || repeatStrikes || aggressiveExecution || nearSpot || 
                      (signalStrength >= 60);
    }

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
        notionalBullish: parseFloat(notionalRatio) > 1.5,
        realDeltaBullish: parseFloat(realDeltaRatio) > 1.5
      },
      netExposure,
      directionalSignal,
      signalStrength: signalStrength.toFixed(1),
      hasClearSignal,
      atmImbalance,
      repeatStrikes,
      aggressiveExecution,
      nearSpot,
      totalFlow,
      isLiveData,
      flowAge: this.getFlowAge(tierFlow),
      takeaway: this.generateTierTakeaway(callNotional, putNotional, callRealDelta, putRealDelta, tierLabel, directionalSignal, isLiveData)
    };
  }

  getFlowAge(flowData) {
    if (!flowData || flowData.length === 0) return 'N/A';
    
    const now = new Date();
    const timestamps = flowData
      .map(f => new Date(f.timestamp || f.timestamp_original || now))
      .filter(ts => !isNaN(ts.getTime()));
    
    if (timestamps.length === 0) return 'N/A';
    
    const oldest = Math.min(...timestamps.map(ts => ts.getTime()));
    const newest = Math.max(...timestamps.map(ts => ts.getTime()));
    
    const ageMinutes = (now - new Date(newest)) / (1000 * 60);
    const rangeMinutes = (new Date(newest) - new Date(oldest)) / (1000 * 60);
    
    return {
      newest: ageMinutes.toFixed(0) + ' minutes ago',
      range: rangeMinutes.toFixed(0) + ' minutes',
      isRecent: ageMinutes <= 10
    };
  }

  applyHierarchyRules(tier1, tier2, allFlowData, spotPrice, isLiveData) {
    // 🚨 TIER-1 IS PRIMARY AND OVERRIDES ALL OTHER SIGNALS
    const hierarchy = {
      primaryDirection: tier1.directionalSignal,
      secondaryContext: tier2.directionalSignal,
      tier1Dominant: false,
      followTier1: false,
      confidenceAdjustment: 0,
      conflictDetected: false,
      interpretation: '',
      isLiveData: isLiveData
    };

    // Check if Tier-1 produces clear directional signal
    if (tier1.hasClearSignal) {
      hierarchy.tier1Dominant = true;
      hierarchy.followTier1 = true;
      
      // Check Primary Follow Rules (Tier-1)
      const followConditions = [];
      
      // 1) Tier-1 Real Delta exposure is dominant vs Tier-2
      const tier1DeltaStrength = Math.abs(tier1.calls.realDelta + tier1.puts.realDelta);
      const tier2DeltaStrength = Math.abs(tier2.calls.realDelta + tier2.puts.realDelta);
      if (tier1DeltaStrength > tier2DeltaStrength * 1.5) {
        followConditions.push('Real Delta dominant');
      }
      
      // 2) Tier-1 ATM (±2%) flow is imbalanced
      if (tier1.atmImbalance) {
        followConditions.push('ATM imbalance');
      }
      
      // 3) Tier-1 prints repeat at same strike
      if (tier1.repeatStrikes) {
        followConditions.push('Repeat strikes');
      }
      
      // 4) Tier-1 execution is aggressive
      if (tier1.aggressiveExecution) {
        followConditions.push('Aggressive execution');
      }
      
      // 5) Tier-1 flow clusters near spot price
      if (tier1.nearSpot) {
        followConditions.push('Near spot clustering');
      }
      
      // 6) For live data: recent flow detection
      if (isLiveData && tier1.flowAge?.isRecent) {
        followConditions.push('Recent live flow');
      }
      
      hierarchy.followConditions = followConditions;
      
      // When ANY condition met → FOLLOW Tier-1
      if (followConditions.length > 0) {
        hierarchy.followTier1 = true;
        const followType = isLiveData ? 'LIVE' : 'HISTORICAL';
        hierarchy.interpretation = `${followType} Tier-1 direction MUST be followed: ${followConditions.join(', ')}`;
      }
    }

    // Check for conflict
    if (tier1.directionalSignal !== 'NEUTRAL' && 
        tier2.directionalSignal !== 'NEUTRAL' &&
        tier1.directionalSignal !== tier2.directionalSignal) {
      hierarchy.conflictDetected = true;
      
      const tier1Context = isLiveData ? 'real-time' : 'urgent';
      const tier2Context = isLiveData ? 'background' : 'patient';
      
      hierarchy.interpretation = 
        `${tier1Context} flow is ${tier1.directionalSignal} while ${tier2Context} flow is ${tier2.directionalSignal} — ` +
        `expect near-term ${tier1.directionalSignal.toLowerCase()} before ${tier2.directionalSignal.toLowerCase()} recovery.`;
    }

    // Confidence adjustment based on alignment and data freshness
    let confidenceAdjustment = 0;
    
    if (tier1.directionalSignal === tier2.directionalSignal) {
      confidenceAdjustment += 15; // Increase confidence
    } else if (hierarchy.conflictDetected) {
      confidenceAdjustment -= 10; // Reduce confidence
    }
    
    // Additional confidence for live data
    if (isLiveData && tier1.flowAge?.isRecent) {
      confidenceAdjustment += 5;
    }
    
    hierarchy.confidenceAdjustment = confidenceAdjustment;

    return hierarchy;
  }

  makeTierDecision(tier1, tier2, hierarchy) {
    const decision = {
      direction: 'NEUTRAL',
      urgency: 'NONE',
      confidence: 50,
      narrative: '',
      guidance: '',
      dataContext: hierarchy.isLiveData ? 'LIVE' : 'HISTORICAL'
    };

    // 🚨 TIER-1 IS PRIMARY DECISION ENGINE
    if (tier1.hasClearSignal && hierarchy.followTier1) {
      decision.direction = tier1.directionalSignal;
      decision.urgency = 'HIGH';
      decision.confidence = Math.min(70 + hierarchy.confidenceAdjustment, 90);
      decision.narrative = `Urgent ${tier1.directionalSignal.toLowerCase()} flow dominates — institutional positioning for immediate move.`;
      
      if (tier1.directionalSignal === 'BULLISH') {
        decision.guidance = hierarchy.isLiveData 
          ? 'FOLLOW LIVE Tier-1 direction: Immediate bullish positioning' 
          : 'FOLLOW Tier-1 direction: Bullish positioning for near-term upside';
      } else if (tier1.directionalSignal === 'BEARISH') {
        decision.guidance = hierarchy.isLiveData 
          ? 'FOLLOW LIVE Tier-1 direction: Immediate defensive hedging' 
          : 'FOLLOW Tier-1 direction: Bearish hedging for near-term protection';
      }
    }
    // If Tier-1 not clear, use Tier-2 for context only
    else if (tier2.directionalSignal !== 'NEUTRAL') {
      decision.direction = tier2.directionalSignal;
      decision.urgency = 'LOW';
      decision.confidence = Math.min(50 + hierarchy.confidenceAdjustment, 65);
      decision.narrative = hierarchy.isLiveData 
        ? `Background ${tier2.directionalSignal.toLowerCase()} conviction — no urgent live signals detected.`
        : `Patient ${tier2.directionalSignal.toLowerCase()} flow provides background conviction — no urgent signals detected.`;
      decision.guidance = 'MONITOR for Tier-1 confirmation before taking directional position';
    }

    // Add conflict context if present
    if (hierarchy.conflictDetected) {
      decision.narrative += ` ${hierarchy.interpretation}`;
      decision.guidance = 'FOLLOW Tier-1 direction despite Tier-2 conflict';
    }

    // Add WebSocket context
    if (hierarchy.isLiveData) {
      decision.narrative += ' [LIVE DATA]';
      if (tier1.flowAge?.isRecent) {
        decision.confidence += 5;
        decision.narrative += ' (Recent flow detected)';
      }
    }

    return decision;
  }

  generateTierTakeaway(callNotional, putNotional, callDelta, putDelta, tierLabel, direction, isLiveData) {
    const total = callNotional + Math.abs(putNotional);
    if (total === 0) return isLiveData ? 'No live flow detected' : 'No flow detected';
    
    const callPercent = (callNotional / total * 100).toFixed(1);
    const putPercent = (Math.abs(putNotional) / total * 100).toFixed(1);
    
    const netDelta = callDelta + putDelta;
    
    const livePrefix = isLiveData ? '🔴 LIVE: ' : '';
    
    if (tierLabel.includes('TIER-1')) {
      if (direction === 'BULLISH') {
        return `${livePrefix}🚨 URGENT: ${callPercent}% call-heavy speculation (Tier-1 PRIMARY direction)`;
      } else if (direction === 'BEARISH') {
        return `${livePrefix}🚨 URGENT: ${putPercent}% put-heavy hedging (Tier-1 PRIMARY direction)`;
      } else {
        return `${livePrefix}🚨 URGENT: Mixed flow (${callPercent}% calls, ${putPercent}% puts) - no clear signal`;
      }
    } else {
      if (direction === 'BULLISH') {
        return `${livePrefix}🐘 PATIENT: ${callPercent}% call-heavy conviction (Tier-2 CONTEXT only)`;
      } else if (direction === 'BEARISH') {
        return `${livePrefix}🐘 PATIENT: ${putPercent}% put-heavy defense (Tier-2 CONTEXT only)`;
      } else {
        return `${livePrefix}🐘 PATIENT: Balanced institutional positioning`;
      }
    }
  }
}

module.exports = TierAnalyzer;
