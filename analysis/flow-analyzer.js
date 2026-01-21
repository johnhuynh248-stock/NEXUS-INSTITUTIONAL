const TradierAPI = require('../api/tradier');
const UnusualWhalesWebSocket = require('../api/unusual-whales-ws'); // WebSocket version
const TierAnalyzer = require('./tier-analyzer');
const DivergenceDetector = require('./divergence-detector');
const Logger = require('../utils/logger');
const moment = require('moment-timezone');
const _ = require('lodash');

class FlowAnalyzer {
  constructor() {
    this.tradier = new TradierAPI();
    this.unusualWhales = new UnusualWhalesWebSocket(); // WebSocket version
    this.tierAnalyzer = new TierAnalyzer();
    this.divergenceDetector = new DivergenceDetector();
    this.logger = new Logger('flow-analyzer');
    
    // Initialize WebSocket connection
    this.initializeWebSocket();
  }

  initializeWebSocket() {
    // Start WebSocket connection
    this.unusualWhales.connect();
    
    // Log WebSocket status
    this.logger.info('Initialized Unusual Whales WebSocket connection');
    
    // Monitor WebSocket connection status
    setInterval(() => {
      const stats = this.unusualWhales.getConnectionStats();
      if (stats.isConnected) {
        this.logger.debug(`WebSocket connected for ${stats.symbolsWithData} symbols, ${stats.messageCount} messages`);
      }
    }, 60000); // Log every minute
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.logger.info('Shutting down WebSocket connection (SIGINT)...');
      this.unusualWhales.disconnect();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      this.logger.info('Shutting down WebSocket connection (SIGTERM)...');
      this.unusualWhales.disconnect();
      process.exit(0);
    });
  }

  async analyzeSymbolFlow(symbol, date = null) {
    // Determine target date for analysis
    const targetDate = date || moment().format('YYYY-MM-DD');
    const isLiveAnalysis = !date && this.isMarketOpen();
    
    this.logger.info(`Analyzing institutional flow for ${symbol} on ${targetDate} ${isLiveAnalysis ? '(LIVE)' : '(HISTORICAL)'}`);
    
    try {
      // Fetch data concurrently WITH DATE PARAMETER
      const [quote, flowData, blocks, complexTrades, deltaConcentration] = await Promise.all([
        this.tradier.getQuote(symbol).catch(() => {
          // If we can't get live quote, use a placeholder for historical analysis
          this.logger.warn(`Could not get quote for ${symbol}, using placeholder`);
          return { symbol, price: 100, timestamp: new Date() };
        }),
        this.unusualWhales.getInstitutionalFlow(symbol, targetDate).catch((error) => {
          this.logger.error(`Error fetching flow for ${symbol}: ${error.message}`);
          return [];
        }),
        this.unusualWhales.getBlocks(symbol, 500, targetDate).catch((error) => {
          this.logger.error(`Error fetching blocks for ${symbol}: ${error.message}`);
          return [];
        }),
        this.unusualWhales.getComplexTrades(symbol, targetDate).catch((error) => {
          this.logger.error(`Error fetching complex trades for ${symbol}: ${error.message}`);
          return [];
        }),
        this.unusualWhales.getDeltaConcentration(symbol, targetDate).catch((error) => {
          this.logger.error(`Error fetching delta concentration for ${symbol}: ${error.message}`);
          return [];
        })
      ]);

      if (flowData.length === 0) {
        // Try to get live blocks if no historical data
        if (isLiveAnalysis) {
          const liveBlocks = await this.unusualWhales.getLiveBlocks(symbol, 10);
          if (liveBlocks.length > 0) {
            this.logger.info(`Using ${liveBlocks.length} live blocks for ${symbol}`);
            flowData.push(...liveBlocks);
          }
        }
        
        if (flowData.length === 0) {
          throw new Error(`No institutional flow data available for ${symbol} on ${targetDate}`);
        }
      }

      // Process flow data with proper date context
      const processedFlow = this.processFlowData(flowData, quote.price || 100, targetDate);
      const hourlyBreakdown = this.calculateHourlyBreakdown(processedFlow, targetDate);
      const tierAnalysis = this.tierAnalyzer.analyzeTiers(processedFlow, quote.price);
      const tierComposition = this.analyzeTierComposition(processedFlow);
      const atmFlow = this.calculateATMFlow(processedFlow, quote.price || 100);
      const complexAnalysis = this.analyzeComplexTrades(complexTrades);
      const deltaAnalysis = this.analyzeDeltaConcentration(deltaConcentration, quote.price || 100);
      const divergences = this.divergenceDetector.detectDivergences(processedFlow, hourlyBreakdown);
      const institutionalLevels = this.calculateInstitutionalLevels(deltaAnalysis, quote.price || 100);

      // Calculate totals
      const totals = this.calculateTotals(processedFlow, tierAnalysis, atmFlow);

      return {
        symbol,
        quote: quote || { symbol, price: 100, timestamp: new Date() },
        timestamp: new Date(),
        analysisDate: targetDate,
        isLiveAnalysis,
        flow: processedFlow,
        hourlyBreakdown,
        tierAnalysis,
        tierComposition,
        atmFlow,
        complexAnalysis,
        deltaAnalysis,
        divergences,
        institutionalLevels,
        totals,
        blocks: blocks.slice(0, 5), // Top 5 blocks
        config: {
          timezone: process.env.TIMEZONE || 'America/New_York',
          atmRange: process.env.ATM_RANGE || 0.02,
          minNotional: process.env.MIN_NOTIONAL || 100000
        }
      };
    } catch (error) {
      this.logger.error(`Analysis error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  isMarketOpen() {
    const now = moment().tz('America/New_York');
    const day = now.day();
    const hour = now.hour();
    const minute = now.minute();
    
    // Market closed on weekends
    if (day === 0 || day === 6) return false;
    
    // Market hours: 9:30 AM - 4:00 PM ET
    if (hour < 9 || hour > 16) return false;
    if (hour === 9 && minute < 30) return false;
    if (hour === 16 && minute > 0) return false;
    
    return true;
  }

  processFlowData(flowData, spotPrice, targetDate) {
    if (!flowData || flowData.length === 0) return [];
    
    return flowData.map(flow => {
      // Calculate distance from spot
      const distancePercent = spotPrice > 0 ? ((flow.strike - spotPrice) / spotPrice) * 100 : 0;
      const distanceAbsolute = flow.strike - spotPrice;
      
      // Calculate real delta (if not provided)
      let realDelta = flow.real_delta || 0;
      if (!realDelta && spotPrice > 0) {
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
      
      // Extract additional fields for tier composition
      const stockPrice = flow.underlying_price || flow.stock_price || 0;
      const isStockOptionCombo = flow.stock_option_combo || 
                                (stockPrice > 0 && flow.option_type && flow.strike);
      
      // Parse timestamp and ensure it's from target date
      let flowTimestamp = new Date(flow.timestamp);
      if (targetDate) {
        // Ensure timestamp matches target date for consistency
        const flowDate = flowTimestamp.toISOString().split('T')[0];
        if (flowDate !== targetDate) {
          // Adjust timestamp to target date while keeping time
          const [year, month, day] = targetDate.split('-').map(Number);
          flowTimestamp.setFullYear(year, month - 1, day);
        }
      }
      
      return {
        ...flow,
        real_delta: realDelta,
        delta_exposure: deltaExposure,
        distance_percent: distancePercent,
        distance_absolute: distanceAbsolute,
        atm: Math.abs(distancePercent) <= 2,
        flow_type: flowType,
        hour: flowTimestamp.getHours(),
        stock_price: stockPrice,
        stock_option_combo: isStockOptionCombo,
        // Add DTE calculation
        dte: flow.dte || this.calculateDTE(flow.expiration, flowTimestamp),
        // Store original timestamp
        timestamp: flowTimestamp,
        // Add analysis date for reference
        analysis_date: targetDate
      };
    });
  }

  calculateDTE(expirationDate, flowDate = new Date()) {
    if (!expirationDate) return 0;
    try {
      const exp = new Date(expirationDate);
      const diffTime = exp - flowDate;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    } catch (error) {
      return 0;
    }
  }

  calculateHourlyBreakdown(flowData, targetDate) {
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
      insights,
      analysisDate: targetDate
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
      const distance = spotPrice > 0 ? ((level.strike - spotPrice) / spotPrice) * 100 : 0;
      
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
    
    const downsideRoom = topSupport && spotPrice > 0
      ? ((spotPrice - topSupport.strike) / spotPrice * 100).toFixed(2)
      : 'N/A';
    
    const upsideRoom = topResistance && spotPrice > 0
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

  analyzeTierComposition(flowData) {
    // Filter for Tier-1 only (0-3 DTE)
    const tier1Flow = flowData.filter(f => f.dte >= 0 && f.dte <= 3);
    
    if (tier1Flow.length === 0) {
      return null;
    }
    
    // Classify flow types
    const byType = {
      'Tier 1 Blocks': { prints: 0, notional: 0 },
      'Standard Institutional': { prints: 0, notional: 0 },
      'Elite Institutional': { prints: 0, notional: 0 },
      'Stock-Option Combos': { prints: 0, notional: 0 }
    };
    
    // Analyze stock-option combos
    const stockOptionCombos = [];
    const eliteInstitutional = {
      prints: 0,
      notional: 0,
      strikes: [],
      callSpreads: { count: 0, target: null }
    };
    
    // Track call spreads for elite institutional
    const callSpreadStrikes = [];
    
    // Analyze each flow
    tier1Flow.forEach(flow => {
      const notional = flow.notional || 0;
      const contracts = flow.contracts || 0;
      
      // Classify by size
      if (notional >= 10000000) {
        byType['Elite Institutional'].prints++;
        byType['Elite Institutional'].notional += notional;
        
        eliteInstitutional.prints++;
        eliteInstitutional.notional += notional;
        eliteInstitutional.strikes.push(flow.strike);
        
        // Detect call spreads
        if (flow.option_type === 'CALL' && (flow.flow_type === 'CALL_SPREAD' || flow.complex_type === 'CALL_SPREAD')) {
          eliteInstitutional.callSpreads.count++;
          if (!eliteInstitutional.callSpreads.target || flow.strike > eliteInstitutional.callSpreads.target) {
            eliteInstitutional.callSpreads.target = flow.strike;
          }
          callSpreadStrikes.push(flow.strike);
        }
        
      } else if (notional >= 1000000) {
        byType['Tier 1 Blocks'].prints++;
        byType['Tier 1 Blocks'].notional += notional;
        
      } else if (notional >= 100000) {
        byType['Standard Institutional'].prints++;
        byType['Standard Institutional'].notional += notional;
      }
      
      // Detect stock-option combos
      if (flow.stock_option_combo && flow.stock_price) {
        byType['Stock-Option Combos'].prints++;
        byType['Stock-Option Combos'].notional += notional;
        
        stockOptionCombos.push({
          stockPrice: flow.stock_price,
          strike: flow.strike,
          optionType: flow.option_type === 'CALL' ? 'C' : 'P',
          intent: this.detectStockOptionIntent(flow)
        });
      }
    });
    
    // Calculate percentages
    const totalNotional = Object.values(byType).reduce((sum, type) => sum + type.notional, 0);
    
    Object.keys(byType).forEach(type => {
      if (totalNotional > 0) {
        byType[type].percent = ((byType[type].notional / totalNotional) * 100).toFixed(0);
      } else {
        byType[type].percent = 0;
      }
    });
    
    // Calculate elite range
    if (eliteInstitutional.strikes.length > 0) {
      eliteInstitutional.range = {
        min: Math.min(...eliteInstitutional.strikes),
        max: Math.max(...eliteInstitutional.strikes)
      };
      eliteInstitutional.percent = totalNotional > 0 
        ? ((eliteInstitutional.notional / totalNotional) * 100).toFixed(0) 
        : 0;
    }
    
    // If we detected call spreads but no specific target, use the max strike
    if (eliteInstitutional.callSpreads.count > 0 && !eliteInstitutional.callSpreads.target) {
      eliteInstitutional.callSpreads.target = Math.max(...callSpreadStrikes);
    }
    
    return {
      totalPrints: tier1Flow.length,
      byType,
      stockOptionCombos: stockOptionCombos.slice(0, 5), // Limit to top 5
      eliteInstitutional: eliteInstitutional.prints > 0 ? eliteInstitutional : null
    };
  }

  detectStockOptionIntent(flow) {
    const isCall = flow.option_type === 'CALL';
    const isBuy = flow.side === 'BUY';
    const stockPrice = flow.stock_price || 0;
    const strike = flow.strike || 0;
    
    if (!isCall && isBuy && strike >= stockPrice * 0.95) {
      return `Protective Put (hedged at $${strike})`;
    } else if (!isCall && isBuy && strike < stockPrice * 0.95) {
      return `Tail Hedge (protection at $${strike})`;
    } else if (isCall && !isBuy && strike > stockPrice) {
      return `Covered Call (income at $${strike})`;
    } else if (!isCall && !isBuy && strike < stockPrice) {
      return `Cash-Secured Put (entry at $${strike})`;
    } else if (isCall && isBuy && strike < stockPrice) {
      return `Stock Replacement (leverage)`;
    } else if (isCall && isBuy && strike > stockPrice) {
      return `Speculative Call (breakout play)`;
    } else if (!isCall && isBuy) {
      return `Protective Put`;
    }
    
    return 'Stock-Option Combo';
  }

  // NEW: Get real-time WebSocket status
  getWebSocketStatus() {
    return this.unusualWhales.getConnectionStats();
  }

  // NEW: Get live flow data (real-time)
  async getLiveFlow(symbol, minutesBack = 10) {
    try {
      const liveBlocks = await this.unusualWhales.getLiveBlocks(symbol, minutesBack);
      const quote = await this.tradier.getQuote(symbol).catch(() => ({ price: 100 }));
      
      return {
        symbol,
        liveBlocks,
        count: liveBlocks.length,
        totalNotional: liveBlocks.reduce((sum, block) => sum + (block.notional || 0), 0),
        spotPrice: quote.price || 100,
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error(`Error getting live flow for ${symbol}: ${error.message}`);
      return {
        symbol,
        liveBlocks: [],
        count: 0,
        totalNotional: 0,
        spotPrice: 100,
        timestamp: new Date()
      };
    }
  }
}

module.exports = FlowAnalyzer;
