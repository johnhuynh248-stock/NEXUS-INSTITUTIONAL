const TradierAPI = require('../api/tradier');
const UnusualWhalesAPI = require('../api/unusual-whales');
const TierAnalyzer = require('./tier-analyzer');
const DivergenceDetector = require('./divergence-detector');
const Logger = require('../utils/logger');
const moment = require('moment-timezone');
const _ = require('lodash');

class FlowAnalyzer {
  constructor() {
    this.tradier = new TradierAPI();
    this.unusualWhales = new UnusualWhalesAPI();
    this.tierAnalyzer = new TierAnalyzer();
    this.divergenceDetector = new DivergenceDetector();
    this.logger = new Logger('flow-analyzer');
  }

  async analyzeSymbolFlow(symbol) {
    this.logger.info(`Analyzing institutional flow for ${symbol}`);
    
    // Fetch data concurrently
    const [quote, flowData, blocks, complexTrades, deltaConcentration] = await Promise.all([
      this.tradier.getQuote(symbol).catch(() => null),
      this.unusualWhales.getInstitutionalFlow(symbol).catch(() => []),
      this.unusualWhales.getBlocks(symbol, 500).catch(() => []),
      this.unusualWhales.getComplexTrades(symbol).catch(() => []),
      this.unusualWhales.getDeltaConcentration(symbol).catch(() => [])
    ]);

    if (!quote) {
      throw new Error(`No quote data available for ${symbol}`);
    }

    // Validate market hours
    if (!this.tradier.isMarketOpen() && flowData.length === 0) {
      throw new Error('Market is closed or no flow data available');
    }

    // Process flow data
    const processedFlow = this.processFlowData(flowData, quote.price);
    const hourlyBreakdown = this.calculateHourlyBreakdown(processedFlow);
    const tierAnalysis = this.tierAnalyzer.analyzeTiers(processedFlow);
    const atmFlow = this.calculateATMFlow(processedFlow, quote.price);
    const complexAnalysis = this.analyzeComplexTrades(complexTrades);
    const deltaAnalysis = this.analyzeDeltaConcentration(deltaConcentration, quote.price);
    const divergences = this.divergenceDetector.detectDivergences(processedFlow, hourlyBreakdown);
    const institutionalLevels = this.calculateInstitutionalLevels(deltaAnalysis, quote.price);

    // Calculate totals
    const totals = this.calculateTotals(processedFlow, tierAnalysis, atmFlow);

    return {
      symbol,
      quote,
      timestamp: new Date(),
      flow: processedFlow,
      hourlyBreakdown,
      tierAnalysis,
      atmFlow,
      complexAnalysis,
      deltaAnalysis,
      divergences,
      institutionalLevels,
      totals,
      blocks: blocks.slice(0, 5), // Top 5 blocks
      config: {
        timezone: process.env.TIMEZONE,
        atmRange: process.env.ATM_RANGE,
        minNotional: process.env.MIN_NOTIONAL
      }
    };
  }

  processFlowData(flowData, spotPrice) {
    if (!flowData || flowData.length === 0) return [];
    
    return flowData.map(flow => {
      // Calculate distance from spot
      const distancePercent = ((flow.strike - spotPrice) / spotPrice) * 100;
      const distanceAbsolute = flow.strike - spotPrice;
      
      // Calculate real delta (if not provided)
      let realDelta = flow.real_delta || 0;
      if (!realDelta) {
        // Simple approximation if real delta not available
        const atmDelta = Math.abs(distancePercent) < 2 ? 0.5 : 
                        distancePercent < 0 ? 0.3 : 0.7;
        realDelta = flow.option_type === 'CALL' ? atmDelta : -atmDelta;
      }
      
      // Calculate delta exposure
      const deltaExposure = realDelta * flow.notional;
      
      // Determine flow type
      let flowType = 'SINGLE';
      if (flow.complex_type) {
        flowType = flow.complex_type;
      }
      
      return {
        ...flow,
        real_delta: realDelta,
        delta_exposure: deltaExposure,
        distance_percent: distancePercent,
        distance_absolute: distanceAbsolute,
        atm: Math.abs(distancePercent) <= 2,
        flow_type: flowType,
        hour: new Date(flow.timestamp).getHours()
      };
    });
  }

  calculateHourlyBreakdown(flowData) {
    const hourly = {};
    
    // Initialize hours 9-16 (market hours)
    for (let hour = 9; hour <= 16; hour++) {
      hourly[hour] = {
        netFlow: 0,
        buyFlow: 0,
        sellFlow: 0,
        trades: 0,
        calls: 0,
        puts: 0
      };
    }
    
    // Aggregate by hour
    flowData.forEach(flow => {
      const hour = flow.hour;
      if (hour >= 9 && hour <= 16 && hourly[hour]) {
        hourly[hour].trades++;
        
        if (flow.side === 'BUY') {
          hourly[hour].buyFlow += flow.notional;
          hourly[hour].netFlow += flow.notional;
        } else if (flow.side === 'SELL') {
          hourly[hour].sellFlow += flow.notional;
          hourly[hour].netFlow -= flow.notional;
        }
        
        if (flow.option_type === 'CALL') {
          hourly[hour].calls++;
        } else {
          hourly[hour].puts++;
        }
      }
    });
    
    // Find strongest hour
    let strongestHour = null;
    let maxFlow = 0;
    
    Object.entries(hourly).forEach(([hour, data]) => {
      if (Math.abs(data.netFlow) > Math.abs(maxFlow)) {
        maxFlow = data.netFlow;
        strongestHour = hour;
      }
    });
    
    // Generate insights
    const insights = this.generateHourlyInsights(hourly);
    
    return {
      hourly,
      strongestHour: {
        hour: strongestHour,
        netFlow: maxFlow,
        trades: strongestHour ? hourly[strongestHour].trades : 0
      },
      insights
    };
  }

  generateHourlyInsights(hourly) {
    const insights = [];
    const hours = Object.keys(hourly).map(Number);
    const netFlows = hours.map(h => hourly[h].netFlow);
    
    // Check for consistency
    const allPositive = netFlows.every(flow => flow >= 0);
    const allNegative = netFlows.every(flow => flow <= 0);
    
    if (allPositive) {
      insights.push('Consistent buying pressure throughout session');
    } else if (allNegative) {
      insights.push('Consistent selling pressure throughout session');
    }
    
    // Check for midday fade
    const morningFlow = netFlows.slice(0, 3).reduce((a, b) => a + b, 0);
    const afternoonFlow = netFlows.slice(-3).reduce((a, b) => a + b, 0);
    
    if (morningFlow > 0 && afternoonFlow < 0 && Math.abs(morningFlow) > Math.abs(afternoonFlow) * 2) {
      insights.push('Strong morning buying followed by afternoon fade');
    } else if (morningFlow < 0 && afternoonFlow > 0 && Math.abs(morningFlow) < Math.abs(afternoonFlow) * 2) {
      insights.push('Morning selling reversed by afternoon buying');
    }
    
    return insights;
  }

  calculateATMFlow(flowData, spotPrice) {
    const atmRange = spotPrice * 0.02; // ±2%
    const atmMin = spotPrice - atmRange;
    const atmMax = spotPrice + atmRange;
    
    const atmFlow = flowData.filter(flow => 
      flow.strike >= atmMin && flow.strike <= atmMax
    );
    
    const calls = atmFlow.filter(f => f.option_type === 'CALL');
    const puts = atmFlow.filter(f => f.option_type === 'PUT');
    
    const callNotional = calls.reduce((sum, f) => sum + f.notional, 0);
    const putNotional = puts.reduce((sum, f) => sum + f.notional, 0);
    
    const callDelta = calls.reduce((sum, f) => sum + f.delta_exposure, 0);
    const putDelta = puts.reduce((sum, f) => sum + f.delta_exposure, 0);
    
    return {
      calls: calls.length,
      puts: puts.length,
      callNotional,
      putNotional,
      callDelta,
      putDelta,
      netNotional: callNotional - putNotional,
      netDelta: callDelta + putDelta, // Note: put delta is negative
      interpretation: this.interpretATMFlow(callNotional, putNotional, callDelta, putDelta)
    };
  }

  interpretATMFlow(callNotional, putNotional, callDelta, putDelta) {
    const ratio = callNotional / putNotional;
    const deltaRatio = callDelta / Math.abs(putDelta);
    
    if (ratio > 1.5 && deltaRatio > 1.5) {
      return 'STRONG SPECULATIVE BUYING - Institutions positioning for upside breakout';
    } else if (ratio < 0.67 && deltaRatio < 0.67) {
      return 'DEFENSIVE HEDGING - Institutions protecting against downside';
    } else if (Math.abs(callDelta + putDelta) < Math.max(callNotional, putNotional) * 0.1) {
      return 'VOLATILITY POSITIONING - Balanced flow suggests volatility plays';
    } else {
      return 'MIXED ATM FLOW - No clear directional bias in near-term strikes';
    }
  }

  analyzeComplexTrades(complexTrades) {
    if (!complexTrades || complexTrades.length === 0) {
      return {
        total: 0,
        byType: {},
        dominantStrategy: null
      };
    }
    
    const byType = {
      'CALL_SPREAD': { count: 0, notional: 0, intent: 'bullish' },
      'PUT_SPREAD': { count: 0, notional: 0, intent: 'bearish' },
      'STRADDLE': { count: 0, notional: 0, intent: 'volatility' },
      'STRANGLE': { count: 0, notional: 0, intent: 'volatility' },
      'PROTECTIVE_PUT': { count: 0, notional: 0, intent: 'hedge' },
      'COVERED_CALL': { count: 0, notional: 0, intent: 'income' },
      'COLLAR': { count: 0, notional: 0, intent: 'protected' },
      'COMBO': { count: 0, notional: 0, intent: 'mixed' }
    };
    
    complexTrades.forEach(trade => {
      const type = trade.strategy_type || 'COMBO';
      if (byType[type]) {
        byType[type].count++;
        byType[type].notional += trade.notional || 0;
      }
    });
    
    // Find dominant strategy
    let dominant = null;
    let maxCount = 0;
    
    Object.entries(byType).forEach(([type, data]) => {
      if (data.count > maxCount) {
        maxCount = data.count;
        dominant = { type, ...data };
      }
    });
    
    return {
      total: complexTrades.length,
      byType,
      dominantStrategy: dominant
    };
  }

  analyzeDeltaConcentration(deltaData, spotPrice) {
    if (!deltaData || deltaData.length === 0) return { levels: [], putWalls: [], callWalls: [] };
    
    // Group by strike
    const byStrike = {};
    
    deltaData.forEach(data => {
      const strike = data.strike;
      if (!byStrike[strike]) {
        byStrike[strike] = {
          strike,
          callDelta: 0,
          putDelta: 0,
          callPrints: 0,
          putPrints: 0,
          callNotional: 0,
          putNotional: 0
        };
      }
      
      if (data.option_type === 'CALL') {
        byStrike[strike].callDelta += data.real_delta || 0;
        byStrike[strike].callPrints++;
        byStrike[strike].callNotional += data.notional || 0;
      } else {
        byStrike[strike].putDelta += data.real_delta || 0;
        byStrike[strike].putPrints++;
        byStrike[strike].putNotional += data.notional || 0;
      }
    });
    
    // Convert to array and calculate total delta
    const levels = Object.values(byStrike).map(level => {
      const totalDelta = level.callDelta + level.putDelta;
      const distance = ((level.strike - spotPrice) / spotPrice) * 100;
      
      return {
        ...level,
        totalDelta,
        distancePercent: distance,
        distanceAbsolute: level.strike - spotPrice,
        belowSpot: level.strike < spotPrice,
        aboveSpot: level.strike > spotPrice
      };
    });
    
    // Sort by total delta magnitude
    levels.sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));
    
    // Find largest walls
    const putWalls = levels
      .filter(l => l.putDelta < 0 && l.strike < spotPrice)
      .sort((a, b) => Math.abs(b.putDelta) - Math.abs(a.putDelta))
      .slice(0, 3);
    
    const callWalls = levels
      .filter(l => l.callDelta > 0 && l.strike > spotPrice)
      .sort((a, b) => Math.abs(b.callDelta) - Math.abs(a.callDelta))
      .slice(0, 3);
    
    return {
      levels: levels.slice(0, 10), // Top 10
      putWalls,
      callWalls
    };
  }

  calculateInstitutionalLevels(deltaAnalysis, spotPrice) {
    const { levels } = deltaAnalysis;
    
    const support = levels
      .filter(l => l.strike < spotPrice)
      .sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));
    
    const resistance = levels
      .filter(l => l.strike > spotPrice)
      .sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));
    
    // Calculate trading range
    const topSupport = support[0];
    const topResistance = resistance[0];
    
    const tradingRange = topSupport && topResistance 
      ? `${topSupport.strike} - ${topResistance.strike}`
      : 'N/A';
    
    const downsideRoom = topSupport 
      ? ((spotPrice - topSupport.strike) / spotPrice * 100).toFixed(2)
      : 'N/A';
    
    const upsideRoom = topResistance
      ? ((topResistance.strike - spotPrice) / spotPrice * 100).toFixed(2)
      : 'N/A';
    
    return {
      support: support.slice(0, 5),
      resistance: resistance.slice(0, 5),
      tradingRange,
      downsideRoom: `${downsideRoom}%`,
      upsideRoom: `${upsideRoom}%`
    };
  }

  calculateTotals(flowData, tierAnalysis, atmFlow) {
    const totalNotional = flowData.reduce((sum, f) => sum + f.notional, 0);
    const totalTrades = flowData.length;
    const avgSize = totalTrades > 0 ? totalNotional / totalTrades : 0;
    
    const buyFlow = flowData.filter(f => f.side === 'BUY').reduce((sum, f) => sum + f.notional, 0);
    const sellFlow = flowData.filter(f => f.side === 'SELL').reduce((sum, f) => sum + f.notional, 0);
    
    const netFlow = buyFlow - sellFlow;
    const buyPercent = totalNotional > 0 ? (buyFlow / totalNotional * 100).toFixed(1) : 0;
    const sellPercent = totalNotional > 0 ? (sellFlow / totalNotional * 100).toFixed(1) : 0;
    
    // Calculate net delta exposure
    const netDeltaExposure = flowData.reduce((sum, f) => sum + f.delta_exposure, 0);
    
    // Classification rate (percentage of flow with clear side)
    const classifiedTrades = flowData.filter(f => f.side).length;
    const classificationRate = totalTrades > 0 ? (classifiedTrades / totalTrades * 100).toFixed(1) : 0;
    
    return {
      totalNotional,
      totalTrades,
      avgSize,
      buyFlow,
      sellFlow,
      netFlow,
      buyPercent,
      sellPercent,
      netDeltaExposure,
      classificationRate,
      bullish: netFlow > totalNotional * 0.1,
      bearish: netFlow < -totalNotional * 0.1,
      neutral: Math.abs(netFlow) <= totalNotional * 0.1
    };
  }
}

module.exports = FlowAnalyzer;
