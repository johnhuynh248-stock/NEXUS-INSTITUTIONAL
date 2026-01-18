const moment = require('moment-timezone');
const config = require('../config');
const Logger = require('../utils/logger');
const AdvancedAnalysis = require('./advanced-analysis');

class ReportBuilder {
  constructor() {
    this.timezone = config.app.timezone;
    this.logger = new Logger('report-builder');
    this.advancedAnalysis = new AdvancedAnalysis();
  }

  buildDailyReport(analysisData) {
    const { symbol, quote, timestamp, totals, hourlyBreakdown, tierAnalysis, tierComposition,
            atmFlow, complexAnalysis, deltaAnalysis, divergences, 
            institutionalLevels, blocks } = analysisData;

    const now = moment.tz(timestamp, this.timezone);
    const sessionStart = moment.tz(`${now.format('YYYY-MM-DD')} ${config.app.sessionStart}`, this.timezone);
    const sessionDuration = moment.duration(now.diff(sessionStart)).asHours().toFixed(1);

    let report = '';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // HEADER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `📊 *DAILY INSTITUTIONAL FLOW – ${symbol}*\n`;
    report += `📅 ${now.format('YYYY-MM-DD')} | ${now.format('HH:mm')} ET\n`;
    report += `⏱️ Session: ${config.app.sessionStart} – ${now.format('HH:mm')} (${sessionDuration}h)\n\n`;
    report += `💵 Spot Price: $${quote.price.toFixed(2)}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DAILY TOTAL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📦 *Buy Volume:* $${this.formatCurrency(totals.buyFlow)} (${totals.buyPercent}%)\n`;
    report += `📉 *Sell Volume:* $${this.formatCurrency(totals.sellFlow)} (${totals.sellPercent}%)\n\n`;
    report += `➡️ *Net Flow:* $${this.formatCurrency(totals.netFlow)} ${this.getSentimentEmoji(totals)}\n`;
    report += `🔢 *Trades:* ${totals.totalTrades} | *Avg Size:* $${this.formatCurrency(totals.avgSize)}\n`;
    report += `🎯 *Classification Rate:* ${totals.classificationRate}%\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // HOURLY BREAKDOWN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `⏰ *HOURLY EQUITY FLOW BREAKDOWN*\n\n`;
    
    Object.entries(hourlyBreakdown.hourly).forEach(([hour, data]) => {
      if (data.trades > 0) {
        const hourLabel = `${hour}:00-${parseInt(hour)+1}:00`;
        const flowSign = data.netFlow >= 0 ? '🟢' : '🔴';
        report += `${flowSign} *${hourLabel}:* $${this.formatCurrency(data.netFlow)} (${data.trades} trades)\n`;
      }
    });
    
    if (hourlyBreakdown.strongestHour.hour) {
      const strongest = hourlyBreakdown.strongestHour;
      report += `\n🔥 *Strongest Hour:*\n`;
      report += `${strongest.hour}:00 → $${this.formatCurrency(strongest.netFlow)} (${strongest.trades} trades)\n`;
    }
    
    if (hourlyBreakdown.insights.length > 0) {
      report += `\n📌 *Insights:*\n`;
      hourlyBreakdown.insights.forEach(insight => {
        report += `• ${insight}\n`;
      });
    }
    report += '\n';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FLOW DIVERGENCES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🚨 *FLOW DIVERGENCES DETECTED*\n\n`;
    
    divergences.forEach(div => {
      if (div.confidence > 0) {
        report += `*${div.type}* (${div.confidence}%)\n`;
        report += `${div.explanation}\n`;
        report += `🎯 *Guidance:* ${div.guidance}\n\n`;
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TIER-1 ANALYSIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `${tierAnalysis.tier1.label}\n\n`;
    
    const t1 = tierAnalysis.tier1;
    report += `*CALLS:*\n`;
    report += `• Notional: $${this.formatCurrency(t1.calls.notional)} (${t1.calls.prints} prints)\n`;
    report += `• Real Delta Exposure: $${this.formatCurrency(t1.calls.realDelta)}\n`;
    report += `• Avg DTE: ${t1.calls.avgDte} | Avg Size: $${this.formatCurrency(t1.calls.avgSize)}\n\n`;
    
    report += `*PUTS:*\n`;
    report += `• Notional: $${this.formatCurrency(t1.puts.notional)} (${t1.puts.prints} prints)\n`;
    report += `• Real Delta Exposure: $${this.formatCurrency(t1.puts.realDelta)}\n`;
    report += `• Avg DTE: ${t1.puts.avgDte} | Avg Size: $${this.formatCurrency(t1.puts.avgSize)}\n\n`;
    
    report += `📊 *TIER RATIO:*\n`;
    report += `• Notional C:P = ${t1.ratio.notional} ${t1.ratio.notionalBullish ? '🐂' : '🐻'}\n`;
    report += `• Real Delta C:P = ${t1.ratio.realDelta}\n\n`;
    report += `➡️ *Net Exposure:* $${this.formatCurrency(t1.netExposure)}\n`;
    report += `🎯 *Takeaway:* ${t1.takeaway}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TIER-2 ANALYSIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `${tierAnalysis.tier2.label}\n\n`;
    
    const t2 = tierAnalysis.tier2;
    report += `*CALLS:*\n`;
    report += `• Notional: $${this.formatCurrency(t2.calls.notional)} (${t2.calls.prints} prints)\n`;
    report += `• Real Delta Exposure: $${this.formatCurrency(t2.calls.realDelta)}\n`;
    report += `• Avg DTE: ${t2.calls.avgDte} | Avg Size: $${this.formatCurrency(t2.calls.avgSize)}\n\n`;
    
    report += `*PUTS:*\n`;
    report += `• Notional: $${this.formatCurrency(t2.puts.notional)} (${t2.puts.prints} prints)\n`;
    report += `• Real Delta Exposure: $${this.formatCurrency(t2.puts.realDelta)}\n`;
    report += `• Avg DTE: ${t2.puts.avgDte} | Avg Size: $${this.formatCurrency(t2.puts.avgSize)}\n\n`;
    
    report += `📊 *TIER RATIO:*\n`;
    report += `• Notional C:P = ${t2.ratio.notional} ${t2.ratio.notionalBullish ? '🐂' : '🐻'}\n`;
    report += `• Real Delta C:P = ${t2.ratio.realDelta}\n\n`;
    report += `➡️ *Net Exposure:* $${this.formatCurrency(t2.netExposure)}\n`;
    report += `🎯 *Takeaway:* ${t2.takeaway}\n\n`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TIER HIERARCHY DECISION ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (tierAnalysis.hierarchy) {
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🎯 *TIER HIERARCHY DECISION ENGINE*\n\n`;
  
  const hierarchy = tierAnalysis.hierarchy;
  const decision = tierAnalysis.decision;
  
  report += `*PRIMARY DIRECTION:* ${hierarchy.primaryDirection}\n`;
  report += `*SECONDARY CONTEXT:* ${hierarchy.secondaryContext}\n\n`;
  
  if (hierarchy.followConditions && hierarchy.followConditions.length > 0) {
    report += `*FOLLOW TIER-1 CONDITIONS MET:*\n`;
    hierarchy.followConditions.forEach(condition => {
      report += `✅ ${condition}\n`;
    });
    report += '\n';
  }
  
  if (hierarchy.conflictDetected) {
    report += `⚠️ *CONFLICT DETECTED:*\n`;
    report += `${hierarchy.interpretation}\n\n`;
  }
  
  report += `*FINAL DECISION:*\n`;
  report += `• Direction: ${decision.direction}\n`;
  report += `• Urgency: ${decision.urgency}\n`;
  report += `• Confidence: ${decision.confidence}/100\n`;
  report += `• Guidance: ${decision.guidance}\n\n`;
  
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRADING STRATEGY GUIDANCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (tierAnalysis.decision && tierAnalysis.decision.direction !== 'NEUTRAL') {
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `📊 *TRADING STRATEGY GUIDANCE*\n\n`;
  
  const decision = tierAnalysis.decision;
  const t1 = tierAnalysis.tier1;
  const t2 = tierAnalysis.tier2;
  const hierarchy = tierAnalysis.hierarchy;
  
  // Scalper Guidance
  report += `🔥 *SCALPER (0-3 DAYS):*\n`;
  if (t1.hasClearSignal && hierarchy.followTier1) {
    const direction = t1.directionalSignal.toLowerCase();
    report += `• SIGNAL: 🚨 STRONG ${t1.directionalSignal} (Tier-1 dominant)\n`;
    report += `• ENTRY: Current levels ($${quote.price.toFixed(2)})\n`;
    
    if (direction === 'bullish') {
      const resistance = institutionalLevels.resistance[0]?.strike || (quote.price * 1.02).toFixed(2);
      report += `• TARGET: $${resistance} (ATM resistance)\n`;
      report += `• STOP: $${institutionalLevels.support[0]?.strike || (quote.price * 0.98).toFixed(2)} (below support)\n`;
    } else {
      const support = institutionalLevels.support[0]?.strike || (quote.price * 0.98).toFixed(2);
      report += `• TARGET: $${support} (ATM support)\n`;
      report += `• STOP: $${institutionalLevels.resistance[0]?.strike || (quote.price * 1.02).toFixed(2)} (above resistance)\n`;
    }
    
    report += `• HOLD: 1-2 days (gamma play)\n`;
    const confidence = Math.min(decision.confidence, 100);
    const size = confidence >= 80 ? '100%' : confidence >= 70 ? '75%' : '50%';
    report += `• SIZE: ${size} normal (${confidence >= 80 ? 'high' : 'moderate'} conviction)\n`;
  } else {
    report += `• SIGNAL: ❌ NO CLEAR TIER-1 SIGNAL\n`;
    report += `• ACTION: STAND ASIDE\n`;
  }
  report += `\n`;
  
  // Swing Trader Guidance
  report += `🌊 *SWING TRADER (3-14 DAYS):*\n`;
  if (t2.directionalSignal !== 'NEUTRAL') {
    const direction = t2.directionalSignal.toLowerCase();
    const alignment = hierarchy.conflictDetected ? 'CONFLICT' : 
                     t1.directionalSignal === t2.directionalSignal ? 'CONFIRMED' : 'NEUTRAL';
    
    report += `• SIGNAL: ${alignment === 'CONFIRMED' ? '📈 STRONG' : '⚠️ MODERATE'} ${t2.directionalSignal} (Tier-2 ${alignment})\n`;
    
    if (direction === 'bullish') {
      const entry = institutionalLevels.support[0]?.strike || (quote.price * 0.99).toFixed(2);
      const target = institutionalLevels.resistance[2]?.strike || (quote.price * 1.05).toFixed(2);
      report += `• ENTRY: $${entry} (dip to support)\n`;
      report += `• TARGET: $${target} (next resistance zone)\n`;
      report += `• STOP: $${(parseFloat(entry) * 0.97).toFixed(2)} (structural break)\n`;
    } else {
      const entry = institutionalLevels.resistance[0]?.strike || (quote.price * 1.01).toFixed(2);
      const target = institutionalLevels.support[2]?.strike || (quote.price * 0.95).toFixed(2);
      report += `• ENTRY: $${entry} (bounce to resistance)\n`;
      report += `• TARGET: $${target} (next support zone)\n`;
      report += `• STOP: $${(parseFloat(entry) * 1.03).toFixed(2)} (structural break)\n`;
    }
    
    report += `• HOLD: 5-10 days (theta positive)\n`;
    const size = alignment === 'CONFIRMED' ? '100%' : alignment === 'CONFLICT' ? '50%' : '75%';
    report += `• SIZE: ${size} normal (${alignment.toLowerCase()} alignment)\n`;
  } else {
    report += `• SIGNAL: ❌ NO CLEAR TIER-2 CONVICTION\n`;
    report += `• ACTION: STAND ASIDE\n`;
  }
  report += `\n`;
} 
   
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TIER COMPOSITION BREAKDOWN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (tierComposition) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `📊 *TIER-1 COMPOSITION BREAKDOWN*\n\n`;
      
      const comp = tierComposition;
      report += `*Total Tier-1 Prints:* ${comp.totalPrints}\n\n`;
      
      if (comp.byType && Object.keys(comp.byType).length > 0) {
        report += `*By Condition Type:*\n`;
        
        Object.entries(comp.byType).forEach(([type, data]) => {
          if (data.prints > 0) {
            report += `• *${type}:* ${data.prints} prints | $${this.formatCurrency(data.notional)} (${data.percent}%)\n`;
          }
        });
        report += '\n';
      }
      
      if (comp.stockOptionCombos && comp.stockOptionCombos.length > 0) {
        report += `*Stock-Option Combos:*\n`;
        comp.stockOptionCombos.forEach(combo => {
          report += `— Stock at $${combo.stockPrice.toFixed(2)} + ${combo.strike}${combo.optionType} = ${combo.intent}\n`;
        });
        report += '\n';
      }
      
      if (comp.eliteInstitutional) {
        const elite = comp.eliteInstitutional;
        report += `*Elite Institutional:* ${elite.prints} prints | $${this.formatCurrency(elite.notional)} (${elite.percent}%)\n`;
        if (elite.range) {
          report += `  Range: $${elite.range.min}-$${elite.range.max}\n`;
        }
        if (elite.callSpreads && elite.callSpreads.count > 0) {
          report += `  Call Spreads: bullish to $${elite.callSpreads.target} (${elite.callSpreads.count} detected, upside capped)\n`;
        }
      }
      report += '\n';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TIER-2 LARGE BLOCK FLOW
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🐘 *TIER-2 LARGE BLOCK FLOW (Patient | 3-14 DTE)*\n\n`;
    
    const t2c = tierAnalysis.tier2;
    report += `*CALLS:*\n`;
    report += `• Notional: $${this.formatCurrency(t2c.calls.notional)} (${t2c.calls.prints} prints)\n`;
    report += `• Real Delta: $${this.formatCurrency(t2c.calls.realDelta)} exposure\n`;
    report += `• Avg DTE: ${t2c.calls.avgDte} days\n`;
    report += `• Avg Size: ${this.calculateAvgContracts(t2c.calls)} contracts\n\n`;
    
    report += `*PUTS:*\n`;
    report += `• Notional: $${this.formatCurrency(t2c.puts.notional)} (${t2c.puts.prints} prints)\n`;
    report += `• Real Delta: $${this.formatCurrency(t2c.puts.realDelta)} exposure\n`;
    report += `• Avg DTE: ${t2c.puts.avgDte} days\n`;
    report += `• Avg Size: ${this.calculateAvgContracts(t2c.puts)} contracts\n\n`;
    
    report += `📊 *TIER-2 RATIO:*\n`;
    const t2NotionalRatio = t2c.puts.notional > 0 ? (t2c.calls.notional / t2c.puts.notional).toFixed(2) : '∞';
    const t2DeltaRatio = Math.abs(t2c.puts.realDelta) > 0 ? (t2c.calls.realDelta / Math.abs(t2c.puts.realDelta)).toFixed(2) : '∞';
    
    report += `• Notional C:P = ${t2NotionalRatio} ${t2c.ratio.notionalBullish ? '🐂' : '🐻'}\n`;
    report += `• Real Delta C:P = ${t2DeltaRatio} ${t2c.ratio.realDeltaBullish ? '🐂' : '🐻'}\n\n`;
    
    report += `➡️ *Net Exposure:* $${this.formatCurrency(t2c.netExposure)}\n`;
    
    // Calculate call-heavy percentage
    const totalT2Flow = t2c.calls.notional + Math.abs(t2c.puts.notional);
    const callPercent = totalT2Flow > 0 ? (t2c.calls.notional / totalT2Flow * 100).toFixed(1) : '0.0';
    const putPercent = totalT2Flow > 0 ? (Math.abs(t2c.puts.notional) / totalT2Flow * 100).toFixed(1) : '0.0';
    
    if (t2c.calls.notional > t2c.puts.notional) {
      report += `→ Patient institutional flow is ${callPercent}% more CALL-heavy\n`;
    } else {
      report += `→ Patient institutional flow is ${putPercent}% more PUT-heavy\n`;
    }
    report += `→ $${this.formatCurrency(t2c.calls.notional)} in calls vs $${this.formatCurrency(t2c.puts.notional)} in puts (daily)\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ATM FLOW
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🎯 *ATM FLOW (±2% STRIKES)*\n\n`;
    
    const atmRange = quote.price * 0.02;
    const atmMin = quote.price - atmRange;
    const atmMax = quote.price + atmRange;
    
    report += `ATM Range: $${atmMin.toFixed(2)}-$${atmMax.toFixed(2)} | Spot: $${quote.price.toFixed(2)}\n\n`;
    
    const totalATM = atmFlow.callNotional + atmFlow.putNotional;
    const callPercentATM = totalATM > 0 ? (atmFlow.callNotional / totalATM * 100).toFixed(1) : 0;
    const putPercentATM = totalATM > 0 ? (atmFlow.putNotional / totalATM * 100).toFixed(1) : 0;
    
    // Calculate ratios
    const notionalRatio = atmFlow.putNotional > 0 ? (atmFlow.callNotional / atmFlow.putNotional).toFixed(2) : atmFlow.callNotional > 0 ? '∞' : '0';
    const deltaRatio = Math.abs(atmFlow.putDelta) > 0 ? (atmFlow.callDelta / Math.abs(atmFlow.putDelta)).toFixed(2) : atmFlow.callDelta > 0 ? '∞' : '0';
    
    report += `*Notional C:P = ${notionalRatio}* | Calls: $${this.formatCurrency(atmFlow.callNotional)}, Puts: $${this.formatCurrency(atmFlow.putNotional)}\n`;
    report += `*Real Delta C:P = ${deltaRatio}* | Calls: $${this.formatCurrency(atmFlow.callDelta)}, Puts: $${this.formatCurrency(atmFlow.putDelta)}\n`;
    report += `*Net Delta Exposure:* $${this.formatCurrency(atmFlow.netDelta)}\n\n`;
    
    const putDominance = atmFlow.putNotional > atmFlow.callNotional ? 
      putPercentATM : callPercentATM;
    
    if (atmFlow.putNotional > atmFlow.callNotional) {
      report += `→ ATM puts outweigh calls by ${putDominance}%\n`;
    } else if (atmFlow.callNotional > atmFlow.putNotional) {
      report += `→ ATM calls outweigh puts by ${putDominance}%\n`;
    } else {
      report += `→ ATM flow balanced\n`;
    }
    report += '\n';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // COMPLEX STRATEGY ANALYSIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (complexAnalysis.total > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🧩 *COMPLEX STRATEGY ANALYSIS*\n\n`;
      report += `*Total Complex Trades:* ${complexAnalysis.total}\n\n`;
      
      // Count by intent
      let bullishCount = 0;
      let bearishCount = 0;
      let volCount = 0;
      let hedgeCount = 0;
      
      Object.entries(complexAnalysis.byType).forEach(([type, data]) => {
        if (data.count > 0) {
          if (data.intent === 'bullish') bullishCount += data.count;
          if (data.intent === 'bearish') bearishCount += data.count;
          if (data.intent === 'volatility' || data.intent === 'volatility play') volCount += data.count;
          if (data.intent === 'hedge' || data.intent === 'protected') hedgeCount += data.count;
        }
      });
      
      report += `*BY STRATEGY TYPE:*\n`;
      
      // Call Spreads
      const callSpreads = complexAnalysis.byType.CALL_SPREAD;
      if (callSpreads && callSpreads.count > 0) {
        report += `  *Call Spreads:* ${callSpreads.count} (Bullish, Defined Risk)\n`;
        report += `  → Bullish positioning but capped upside\n`;
      }
      
      // Put Spreads
      const putSpreads = complexAnalysis.byType.PUT_SPREAD;
      if (putSpreads && putSpreads.count > 0) {
        report += `  *Put Spreads:* ${putSpreads.count} (Bearish, Defined Risk)\n`;
        report += `  → Bearish positioning with limited downside\n`;
      }
      
      // Straddles/Strangles
      const straddles = complexAnalysis.byType.STRADDLE;
      const strangles = complexAnalysis.byType.STRANGLE;
      const volTrades = (straddles?.count || 0) + (strangles?.count || 0);
      if (volTrades > 0) {
        report += `  *Straddles/Strangles:* ${volTrades} (Volatility Play)\n`;
        report += `  → Expecting big move (direction unknown)\n`;
      }
      
      // Protective Puts
      const protectivePuts = complexAnalysis.byType.PROTECTIVE_PUT;
      if (protectivePuts && protectivePuts.count > 0) {
        report += `  *Protective Puts:* ${protectivePuts.count} (Downside Hedge)\n`;
        report += `  → Long stock + long puts = protected long\n`;
      }
      
      // Covered Calls
      const coveredCalls = complexAnalysis.byType.COVERED_CALL;
      if (coveredCalls && coveredCalls.count > 0) {
        report += `  *Covered Calls:* ${coveredCalls.count} (Income, Capped Upside)\n`;
        report += `  → Long stock + short calls = income generation\n`;
      }
      
      // Collars
      const collars = complexAnalysis.byType.COLLAR;
      if (collars && collars.count > 0) {
        report += `  *Collars:* ${collars.count} (Protected, Capped)\n`;
        report += `  → Long stock + long puts + short calls = protected range\n`;
      }
      
      report += `\n*BY INTENT:*\n`;
      const totalIntent = bullishCount + bearishCount + volCount + hedgeCount;
      
      if (bullishCount > 0) {
        const percent = totalIntent > 0 ? Math.round((bullishCount / totalIntent) * 100) : 0;
        report += `  *Bullish:* ${bullishCount} (${percent}%)\n`;
      }
      
      if (bearishCount > 0) {
        const percent = totalIntent > 0 ? Math.round((bearishCount / totalIntent) * 100) : 0;
        report += `  *Bearish:* ${bearishCount} (${percent}%)\n`;
      }
      
      if (volCount > 0) {
        const percent = totalIntent > 0 ? Math.round((volCount / totalIntent) * 100) : 0;
        report += `  *Volatility:* ${volCount} (${percent}%)\n`;
      }
      
      if (hedgeCount > 0) {
        const percent = totalIntent > 0 ? Math.round((hedgeCount / totalIntent) * 100) : 0;
        report += `  *Hedge:* ${hedgeCount} (${percent}%)\n`;
      }
      
      if (complexAnalysis.dominantStrategy) {
        const dom = complexAnalysis.dominantStrategy;
        report += `\n⭐ *DOMINANT PATTERN:* ${dom.type}\n`;
        
        if (dom.type === 'CALL_SPREAD') {
          report += `→ Bullish positioning with defined risk/reward\n`;
          report += `→ Watch for resistance at spread strikes\n`;
        } else if (dom.type === 'PUT_SPREAD') {
          report += `→ Bearish positioning with limited downside\n`;
          report += `→ Watch for support at spread strikes\n`;
        } else if (dom.type === 'STRADDLE' || dom.type === 'STRANGLE') {
          report += `→ Volatility expansion expected\n`;
          report += `→ Direction unknown, but expecting large move\n`;
        } else if (dom.type === 'PROTECTIVE_PUT') {
          report += `→ Defensive positioning with downside protection\n`;
          report += `→ Hedging existing long exposure\n`;
        } else if (dom.type === 'COVERED_CALL') {
          report += `→ Income generation with capped upside\n`;
          report += `→ Neutral to slightly bullish outlook\n`;
        }
      }
      report += '\n';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TOP INSTITUTIONAL PRINTS BY TIER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (blocks && blocks.length > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🏆 *TOP INSTITUTIONAL PRINTS BY TIER*\n\n`;
      
      blocks.slice(0, 5).forEach((block, idx) => {
        const time = moment.tz(block.timestamp, this.timezone).format('HH:mm');
        const type = block.option_type === 'CALL' ? 'C' : 'P';
        const distPercent = ((block.strike - quote.price) / quote.price * 100).toFixed(2);
        const distSign = parseFloat(distPercent) >= 0 ? '+' : '';
        
        // Check if at spot (within 0.1%)
        const atSpot = Math.abs(parseFloat(distPercent)) <= 0.1;
        const atSpotLabel = atSpot ? ' < AT SPOT' : '';
        
        report += `${idx + 1}) *${block.strike}${type}_${block.expiration}* @ ${time}\n`;
        report += `   ${block.contracts} contracts × $${this.formatCurrency(block.notional)}\n`;
        report += `   → Real Delta: $${this.formatCurrency(block.real_delta * block.notional || 0)}\n`;
        report += `   → ${this.getBlockType(block)} | DTE: ${block.dte || 'N/A'} | Strike: ${distSign}${distPercent}%${atSpotLabel}\n`;
        report += `   → ${this.interpretBlock(block, quote.price)}\n\n`;
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TOP 10 REAL DELTA CONCENTRATION POINTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (deltaAnalysis.levels.length > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🧱 *TOP 10 REAL DELTA CONCENTRATION POINTS (Daily)*\n\n`;
      
      deltaAnalysis.levels.slice(0, 10).forEach((level, idx) => {
        const distPercent = ((level.strike - quote.price) / quote.price * 100).toFixed(2);
        const distSign = parseFloat(distPercent) >= 0 ? '+' : '';
        
        // Check if at spot (within 0.1%)
        const atSpot = Math.abs(parseFloat(distPercent)) <= 0.1;
        const atSpotLabel = atSpot ? ' < AT SPOT' : '';
        
        // Format distance for display
        const displayDistance = atSpot ? '' : ` (${distSign}${distPercent})`;
        
        const optionType = level.callDelta > Math.abs(level.putDelta) ? 'C' : 'P';
        const realDelta = level.callDelta + level.putDelta;
        const realDeltaFormatted = realDelta >= 0 ? `$${this.formatCurrency(realDelta)}` : `$${this.formatCurrency(Math.abs(realDelta))}`;
        
        report += `${idx + 1}) ${level.strike}${optionType}_${this.getExpirationFromFlow(level)}: ${realDelta >= 0 ? '+' : '-'}$${this.formatCurrency(Math.abs(realDelta))} real delta\n`;
        report += `   (${level.callPrints + level.putPrints} prints, $${this.formatCurrency(level.callNotional + level.putNotional)})${displayDistance}${atSpotLabel}\n`;
      });
      
      if (deltaAnalysis.putWalls.length > 0) {
        const largestPut = deltaAnalysis.putWalls[0];
        const putDist = ((largestPut.strike - quote.price) / quote.price * 100).toFixed(2);
        const putDistSign = parseFloat(putDist) >= 0 ? '+' : '';
        
        report += `\n→ *Largest put concentration:* ${largestPut.strike}P_${this.getExpirationFromFlow(largestPut)}\n`;
        report += `  $${this.formatCurrency(Math.abs(largestPut.putDelta))} delta wall defending $${largestPut.strike}\n`;
      }
      
      if (deltaAnalysis.callWalls.length > 0) {
        const largestCall = deltaAnalysis.callWalls[0];
        const callDist = ((largestCall.strike - quote.price) / quote.price * 100).toFixed(2);
        
        report += `→ *Largest call concentration:* ${largestCall.strike}C_${this.getExpirationFromFlow(largestCall)}\n`;
        report += `  $${this.formatCurrency(largestCall.callDelta)} delta resistance at $${largestCall.strike}\n`;
      }
      report += '\n';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // KEY INSTITUTIONAL LEVELS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🎯 *KEY INSTITUTIONAL LEVELS*\n\n`;
    
    if (institutionalLevels.support.length > 0) {
      report += `📉 *SUPPORT LEVELS:*\n`;
      institutionalLevels.support.forEach(level => {
        const distPercent = ((level.strike - quote.price) / quote.price * 100).toFixed(1);
        report += `• $${level.strike} (${distPercent}%) | Delta: $${this.formatCurrency(level.totalDelta)} | Prints: ${level.callPrints + level.putPrints}\n`;
      });
      report += '\n';
    }
    
    if (institutionalLevels.resistance.length > 0) {
      report += `📈 *RESISTANCE LEVELS:*\n`;
      institutionalLevels.resistance.forEach(level => {
        const distPercent = ((level.strike - quote.price) / quote.price * 100).toFixed(1);
        report += `• $${level.strike} (+${distPercent}%) | Delta: $${this.formatCurrency(level.totalDelta)} | Prints: ${level.callPrints + level.putPrints}\n`;
      });
      report += '\n';
    }
    
    report += `*Trading Range:* ${institutionalLevels.tradingRange}\n`;
    report += `*Downside Room:* ${institutionalLevels.downsideRoom}\n`;
    report += `*Upside Room:* ${institutionalLevels.upsideRoom}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DAILY FLOW SUMMARY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📈 *DAILY FLOW SUMMARY*\n\n`;

    report += `*Total Institutional Trades:* ${totals.totalTrades}\n`;
    report += `*Total Notional:* $${this.formatCurrency(totals.totalNotional)}\n`;
    report += `*Net Delta Exposure:* $${this.formatCurrency(totals.netDeltaExposure)}\n`;

    // Calculate equity flow (simplified - would need actual equity flow data)
    const equityFlow = 0; // This would come from separate equity flow analysis
    const equityFlowFormatted = equityFlow >= 0 ? `$${this.formatCurrency(equityFlow)}` : `$${this.formatCurrency(Math.abs(equityFlow))}`;
    const equitySentiment = Math.abs(equityFlow) > totals.totalNotional * 0.05 ? 
      (equityFlow > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';

    report += `*Equity Flow:* ${equityFlowFormatted} ${equitySentiment}\n\n`;

    // Tier-1 options summary
    const t1Summary = tierAnalysis.tier1;
    const t1Total = t1Summary.calls.notional + Math.abs(t1Summary.puts.notional);
    const t1BullishPercent = t1Summary.calls.notional > t1Summary.puts.notional ? 
      (t1Total > 0 ? ((t1Summary.calls.notional - Math.abs(t1Summary.puts.notional)) / t1Total * 100).toFixed(0) : '0') :
      (t1Total > 0 ? ((Math.abs(t1Summary.puts.notional) - t1Summary.calls.notional) / t1Total * 100).toFixed(0) : '0');

    report += `• *Tier-1 Options:* ${t1Summary.calls.notional > t1Summary.puts.notional ? '+' : '-'}${t1BullishPercent}% ${t1Summary.calls.notional > t1Summary.puts.notional ? 'BULLISH' : 'BEARISH'}\n`;
    report += `  ($${this.formatCurrency(t1Summary.calls.notional)} calls vs $${this.formatCurrency(Math.abs(t1Summary.puts.notional))} puts)\n`;

    // Tier-2 options summary
    const t2Summary = tierAnalysis.tier2;
    const t2Total = t2Summary.calls.notional + Math.abs(t2Summary.puts.notional);
    const t2BullishPercent = t2Summary.calls.notional > t2Summary.puts.notional ? 
      (t2Total > 0 ? ((t2Summary.calls.notional - Math.abs(t2Summary.puts.notional)) / t2Total * 100).toFixed(0) : '0') :
      (t2Total > 0 ? ((Math.abs(t2Summary.puts.notional) - t2Summary.calls.notional) / t2Total * 100).toFixed(0) : '0');

    report += `• *Tier-2 Options:* ${t2Summary.calls.notional > t2Summary.puts.notional ? '+' : '-'}${t2BullishPercent}% ${t2Summary.calls.notional > t2Summary.puts.notional ? 'BULLISH' : 'BEARISH'}\n`;
    report += `  ($${this.formatCurrency(t2Summary.calls.notional)} calls vs $${this.formatCurrency(Math.abs(t2Summary.puts.notional))} puts)\n`;

    // ATM positioning summary
    const atmTotal = atmFlow.callNotional + atmFlow.putNotional;
    const atmBullishPercent = atmFlow.callNotional > atmFlow.putNotional ?
      (atmTotal > 0 ? ((atmFlow.callNotional - atmFlow.putNotional) / atmTotal * 100).toFixed(0) : '0') :
      (atmTotal > 0 ? ((atmFlow.putNotional - atmFlow.callNotional) / atmTotal * 100).toFixed(0) : '0');

    const atmDescription = atmFlow.callNotional > atmFlow.putNotional ? 
      '(near-money call preference)' : '(near-money put hedging)';

    report += `• *ATM Positioning:* ${atmFlow.callNotional > atmFlow.putNotional ? '+' : '-'}${atmBullishPercent}% ${atmFlow.callNotional > atmFlow.putNotional ? 'BULLISH' : 'BEARISH'}\n`;
    report += `  ${atmDescription}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INSTITUTIONAL THESIS (FULL DAY)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🎯 *INSTITUTIONAL THESIS (Full Day)*\n\n`;

    const thesis = this.generateInstitutionalThesis(analysisData);

    // Light equity flow comment
    const equityFlowSize = Math.abs(equityFlow);
    const equityFlowComment = equityFlowSize < totals.totalNotional * 0.1 ? 
      '**Light equity flow**' : 
      equityFlow > 0 ? '**Strong equity buying**' : '**Heavy equity selling**';
      
    report += `${equityFlowComment} (${equityFlow >= 0 ? '+' : ''}$${this.formatCurrency(equityFlow)} net)\n`;

    // Urgent vs patient flow
    const urgentFlowComment = t1Summary.calls.notional > t1Summary.puts.notional ? 
      `**Urgent institutional flow is ${t1BullishPercent}% more CALL-heavy** (0-3 DTE speculation)` :
      `**Urgent institutional flow is ${t1BullishPercent}% more PUT-heavy** (0-3 DTE hedging)`;
      
    report += `${urgentFlowComment}\n`;

    const patientFlowComment = t2Summary.calls.notional > t2Summary.puts.notional ?
      `**Patient institutional flow is ${t2BullishPercent}% more CALL-heavy** (3-14 DTE conviction)` :
      `**Patient institutional flow is ${t2BullishPercent}% more PUT-heavy** (3-14 DTE defense)`;
      
    report += `${patientFlowComment}\n`;

    // ATM flow comment
    const atmFlowComment = atmFlow.putNotional > atmFlow.callNotional ?
      `**ATM puts outweigh calls** by ${atmBullishPercent}%` :
      `**ATM calls outweigh puts** by ${atmBullishPercent}%`;
      
    report += `${atmFlowComment}\n`;

    // Key institutional levels
    report += `**KEY INSTITUTIONAL LEVELS:**\n`;

    if (institutionalLevels.support.length > 0) {
      const supportLevels = institutionalLevels.support.slice(0, 3).map(l => `$${l.strike}`).join(', ');
      report += `Support: ${supportLevels}\n`;
    }

    if (institutionalLevels.resistance.length > 0) {
      const resistanceLevels = institutionalLevels.resistance.slice(0, 3).map(l => `$${l.strike}`).join(', ');
      report += `Resistance: ${resistanceLevels}\n`;
    }

    // Interpretation based on conflicting signals
    report += `\n**INTERPRETATION:**\n`;

    const hasConflict = (t1Summary.calls.notional > t1Summary.puts.notional) !== (t2Summary.calls.notional > t2Summary.puts.notional);
    if (hasConflict) {
      if (t1Summary.calls.notional > t1Summary.puts.notional && t2Summary.puts.notional > t2Summary.calls.notional) {
        report += `Conflicting signals: Urgent flow bullish but patient flow bearish. Near-term strength possible, but caution advised.\n`;
      } else if (t1Summary.puts.notional > t1Summary.calls.notional && t2Summary.calls.notional > t2Summary.puts.notional) {
        report += `Conflicting signals: Urgent flow bearish but patient flow bullish. Near-term dip possible, but recovery expected.\n`;
      }
    } else {
      if (t1Summary.calls.notional > t1Summary.puts.notional) {
        report += `Harmonious bullish flow across all timeframes. Expect continued upward pressure.\n`;
      } else {
        report += `Harmonious bearish flow across all timeframes. Expect continued downward pressure.\n`;
      }
    }

    report += `\n🎯 *Confidence Score:* ${thesis.confidence}/100\n\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `*END OF INSTITUTIONAL FLOW REPORT*\n`;
    report += `⚠️ This is NOT retail advice. Institutional data only.`;

    return report;
  }

  buildSummaryReport(analysisData) {
    const { symbol, quote, totals, tierAnalysis, atmFlow } = analysisData;
    
    let summary = '';
    summary += `💵 Spot: $${quote.price.toFixed(2)}\n`;
    summary += `📊 Flow: $${this.formatCurrency(totals.netFlow)} ${this.getSentimentEmoji(totals)}\n`;
    summary += `🔢 Trades: ${totals.totalTrades}\n`;
    summary += `🚨 Tier-1: ${tierAnalysis.tier1.ratio.notionalBullish ? '🐂' : '🐻'}\n`;
    summary += `🐘 Tier-2: ${tierAnalysis.tier2.ratio.notionalBullish ? '🐂' : '🐻'}\n`;
    summary += `🎯 ATM: ${atmFlow.netNotional > 0 ? '🐂' : '🐻'}`;
    
    return summary;
  }

  // Helper Methods
  formatCurrency(amount) {
    if (amount === 0) return '0';
    if (Math.abs(amount) >= 1000000) {
      return (amount / 1000000).toFixed(2) + 'M';
    } else if (Math.abs(amount) >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return Math.abs(amount).toFixed(0);
  }

  getSentimentEmoji(totals) {
    if (totals.bullish) return '🐂 BULLISH';
    if (totals.bearish) return '🐻 BEARISH';
    return '⚪ NEUTRAL';
  }

  getBlockType(block) {
    const notional = block.notional || 0;
    if (notional >= 10000000) return 'ELITE INSTITUTIONAL';
    if (notional >= 1000000) return 'LARGE BLOCK';
    if (notional >= 500000) return 'INSTITUTIONAL';
    return 'SIZEABLE';
  }

  interpretBlock(block, spotPrice) {
    const isCall = block.option_type === 'CALL';
    const isBuy = block.side === 'BUY';
    const distance = ((block.strike - spotPrice) / spotPrice * 100).toFixed(1);
    
    if (isCall && isBuy && Math.abs(parseFloat(distance)) <= 2) {
      return 'ATM call buying - directional speculation';
    } else if (isCall && isBuy && parseFloat(distance) >= 2) {
      return 'OTM call buying - leverage/volatility play';
    } else if (!isCall && isBuy && Math.abs(parseFloat(distance)) <= 2) {
      return 'ATM put buying - hedging/protection';
    } else if (!isCall && isBuy && parseFloat(distance) < -2) {
      return 'OTM put buying - tail risk protection';
    } else if (isCall && !isBuy) {
      return 'Call selling - income/volatility crush';
    } else if (!isCall && !isBuy) {
      return 'Put selling - premium collection/pin risk';
    }
    
    return 'Institutional positioning';
  }

  getDealerPositioningExplanation(deltaAnalysis, spotPrice) {
    const { putWalls, callWalls } = deltaAnalysis;
    
    if (putWalls.length === 0 && callWalls.length === 0) {
      return 'No significant dealer gamma exposure detected';
    }
    
    const closestPut = putWalls[0];
    const closestCall = callWalls[0];
    
    if (closestPut && closestCall) {
      const putDist = Math.abs(closestPut.distancePercent);
      const callDist = Math.abs(closestCall.distancePercent);
      
      if (putDist < 3 && callDist < 3) {
        return 'Dealers short gamma in tight range - expect amplified moves';
      } else if (putDist > 5 && callDist > 5) {
        return 'Dealers long gamma at wings - expect compression near spot';
      } else {
        return 'Mixed dealer positioning - monitor for gamma flip';
      }
    }
    
    return 'Asymmetric dealer exposure detected';
  }

  calculateAvgContracts(tierData) {
    if (!tierData.avgSize || tierData.avgSize === 0) return 0;
    
    // Estimate contracts based on avg size (assuming avg option price ~$2.50)
    const avgOptionPrice = 2.50;
    const estimatedContracts = Math.round(tierData.avgSize / (avgOptionPrice * 100));
    
    return estimatedContracts || 0;
  }

  getExpirationFromFlow(flow) {
    // Extract or generate expiration date from flow data
    if (flow.expiration) {
      const date = new Date(flow.expiration);
      return date.toISOString().split('T')[0];
    }
    // Return a placeholder or calculate from DTE
    const today = new Date();
    const expiration = new Date(today);
    expiration.setDate(today.getDate() + 7); // Default to 7 days out
    return expiration.toISOString().split('T')[0];
  }

  generateInstitutionalThesis(analysisData) {
    const { totals, tierAnalysis, atmFlow, divergences } = analysisData;
    
    let confidence = 70; // Base confidence
    
    // Adjust confidence based on data quality
    if (totals.classificationRate > 80) confidence += 10;
    if (totals.classificationRate < 50) confidence -= 15;
    
    // Adjust for divergence detection
    if (divergences.length > 1 && divergences[0].confidence > 70) confidence -= 10;
    
    // Adjust for conflicting signals
    const t1 = tierAnalysis.tier1;
    const t2 = tierAnalysis.tier2;
    const hasConflict = (t1.calls.notional > t1.puts.notional) !== (t2.calls.notional > t2.puts.notional);
    if (hasConflict) confidence -= 10;
    
    // Adjust for data completeness
    if (totals.totalTrades < 10) confidence -= 20;
    if (totals.totalTrades > 100) confidence += 10;
    
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));
    
    return {
      confidence
    };
  }
}

module.exports = ReportBuilder;
