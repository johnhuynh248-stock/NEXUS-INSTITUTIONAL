const moment = require('moment-timezone');
const config = require('../config');
const Logger = require('../utils/logger');

class ReportBuilder {
  constructor() {
    this.timezone = config.app.timezone;
    this.logger = new Logger('report-builder');
  }

  buildDailyReport(analysisData) {
    const { symbol, quote, timestamp, totals, hourlyBreakdown, tierAnalysis, 
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
    // ATM FLOW
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🎯 *ATM FLOW (±2% STRIKES)*\n\n`;
    report += `*CALLS:* $${this.formatCurrency(atmFlow.callNotional)} (${atmFlow.calls} prints)\n`;
    report += `*PUTS:* $${this.formatCurrency(atmFlow.putNotional)} (${atmFlow.puts} prints)\n`;
    report += `*Real Delta:* $${this.formatCurrency(atmFlow.netDelta)}\n`;
    report += `*Net ATM Exposure:* $${this.formatCurrency(atmFlow.netNotional)}\n\n`;
    report += `→ ${atmFlow.interpretation}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // COMPLEX STRATEGIES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (complexAnalysis.total > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🧩 *COMPLEX STRATEGY ANALYSIS*\n\n`;
      report += `*Total Complex Trades:* ${complexAnalysis.total}\n\n`;
      
      Object.entries(complexAnalysis.byType).forEach(([type, data]) => {
        if (data.count > 0) {
          report += `*${type}:* ${data.count} trades | $${this.formatCurrency(data.notional)}\n`;
        }
      });
      
      if (complexAnalysis.dominantStrategy) {
        const dom = complexAnalysis.dominantStrategy;
        report += `\n⭐ *DOMINANT STRATEGY:* ${dom.type}\n`;
        report += `• Intent: ${dom.intent}\n`;
        report += `• Notional: $${this.formatCurrency(dom.notional)}\n`;
      }
      report += '\n';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TOP INSTITUTIONAL PRINTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (blocks && blocks.length > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🏆 *TOP INSTITUTIONAL PRINTS*\n\n`;
      
      blocks.slice(0, 5).forEach((block, idx) => {
        const time = moment.tz(block.timestamp, this.timezone).format('HH:mm');
        const type = block.option_type === 'CALL' ? 'C' : 'P';
        const distPercent = ((block.strike - quote.price) / quote.price * 100).toFixed(1);
        
        report += `${idx + 1}) *${block.strike}${type}_${block.expiration}* @ ${time}\n`;
        report += `   ${block.contracts} contracts × $${this.formatCurrency(block.notional)}\n`;
        report += `   → Real Delta: $${this.formatCurrency(block.real_delta * block.notional || 0)}\n`;
        report += `   → ${this.getBlockType(block)} | DTE: ${block.dte || 'N/A'} | Strike: ${distPercent}%\n`;
        report += `   → ${this.interpretBlock(block, quote.price)}\n\n`;
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DELTA CONCENTRATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (deltaAnalysis.levels.length > 0) {
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🧱 *TOP DELTA CONCENTRATION POINTS*\n\n`;
      
      deltaAnalysis.levels.slice(0, 10).forEach((level, idx) => {
        const distSign = level.distancePercent >= 0 ? '+' : '';
        report += `${idx + 1}) *$${level.strike}* ${distSign}${level.distancePercent.toFixed(1)}%\n`;
        report += `   Real Delta: $${this.formatCurrency(level.totalDelta)} | Prints: ${level.callPrints + level.putPrints}\n`;
        report += `   Notional: $${this.formatCurrency(level.callNotional + level.putNotional)}\n\n`;
      });
      
      if (deltaAnalysis.putWalls.length > 0) {
        const largestPut = deltaAnalysis.putWalls[0];
        report += `🧱 *Largest PUT Wall (Support):* $${largestPut.strike} (-${Math.abs(largestPut.distancePercent).toFixed(1)}%)\n`;
      }
      
      if (deltaAnalysis.callWalls.length > 0) {
        const largestCall = deltaAnalysis.callWalls[0];
        report += `🚧 *Largest CALL Wall (Resistance):* $${largestCall.strike} (+${largestCall.distancePercent.toFixed(1)}%)\n`;
      }
      
      report += `🎯 *Dealer Positioning:* ${this.getDealerPositioningExplanation(deltaAnalysis, quote.price)}\n\n`;
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
    report += `📊 Total Institutional Trades: ${totals.totalTrades}\n`;
    report += `💰 Total Notional: $${this.formatCurrency(totals.totalNotional)}\n`;
    report += `🧮 Net Delta Exposure: $${this.formatCurrency(totals.netDeltaExposure)}\n\n`;
    
    const t1Bullish = tierAnalysis.tier1.ratio.notionalBullish;
    const t2Bullish = tierAnalysis.tier2.ratio.notionalBullish;
    const atmBullish = atmFlow.netNotional > 0;
    
    report += `• Tier-1 Options: ${t1Bullish ? '🐂 BULLISH' : '🐻 BEARISH'}\n`;
    report += `• Tier-2 Options: ${t2Bullish ? '🐂 BULLISH' : '🐻 BEARISH'}\n`;
    report += `• ATM Positioning: ${atmBullish ? '🐂 BULLISH' : '🐻 BEARISH'}\n\n`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INSTITUTIONAL THESIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🎯 *INSTITUTIONAL THESIS*\n\n`;
    
    const thesis = this.generateInstitutionalThesis(analysisData);
    thesis.bullets.forEach(bullet => {
      report += `• ${bullet}\n`;
    });
    
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
    
    if (isCall && isBuy && parseFloat(distance) < 2) {
      return 'ATM call buying - directional speculation';
    } else if (isCall && isBuy && parseFloat(distance) >= 2) {
      return 'OTM call buying - leverage/volatility play';
    } else if (!isCall && isBuy && Math.abs(parseFloat(distance)) < 2) {
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

  generateInstitutionalThesis(analysisData) {
    const { totals, tierAnalysis, atmFlow, divergences, institutionalLevels } = analysisData;
    
    const bullets = [];
    let confidence = 70; // Base confidence
    
    // 1. Equity flow tone
    if (totals.bullish) {
      bullets.push('Overall institutional tone is BULLISH with net buying pressure');
      confidence += 5;
    } else if (totals.bearish) {
      bullets.push('Overall institutional tone is BEARISH with net selling pressure');
      confidence += 5;
    } else {
      bullets.push('Institutional flow shows NEUTRAL bias with balanced buying/selling');
    }
    
    // 2. Urgent vs patient conflict
    const t1Bullish = tierAnalysis.tier1.ratio.notionalBullish;
    const t2Bullish = tierAnalysis.tier2.ratio.notionalBullish;
    
    if (t1Bullish !== t2Bullish) {
      bullets.push(`Conflict detected: ${t1Bullish ? 'Urgent' : 'Patient'} flow is ${t1Bullish ? 'bullish' : 'bearish'} vs ${t2Bullish ? 'Patient' : 'Urgent'} flow is ${t2Bullish ? 'bullish' : 'bearish'}`);
      confidence -= 10;
    } else {
      bullets.push(`Harmonious flow: Both urgent and patient positioning align ${t1Bullish ? 'bullishly' : 'bearishly'}`);
      confidence += 5;
    }
    
    // 3. Dealer positioning
    if (atmFlow.netNotional > atmFlow.callNotional * 0.3) {
      bullets.push('Dealers likely long gamma from ATM call buying - supports orderly moves');
      confidence += 5;
    } else if (atmFlow.netNotional < -atmFlow.putNotional * 0.3) {
      bullets.push('Dealers likely short gamma from ATM put selling - risk of amplified moves');
      confidence -= 5;
    }
    
    // 4. Key support/resistance
    if (institutionalLevels.support.length > 0 && institutionalLevels.resistance.length > 0) {
      const support = institutionalLevels.support[0];
      const resistance = institutionalLevels.resistance[0];
      
      bullets.push(`Key levels: Support at $${support.strike}, Resistance at $${resistance.strike}`);
      confidence += 5;
    }
    
    // 5. Expected near-term behavior
    if (divergences.some(d => d.type.includes('VOL_CRUSH'))) {
      bullets.push('Expect range-bound price action with volatility compression');
      confidence += 5;
    } else if (t1Bullish && atmFlow.netNotional > 0) {
      bullets.push('Near-term bias is for continuation of bullish momentum');
      confidence += 10;
    } else if (!t1Bullish && atmFlow.netNotional < 0) {
      bullets.push('Near-term bias is for defensive/range-bound trading');
      confidence += 5;
    }
    
    // 6. Flow quality assessment
    if (totals.classificationRate > 80) {
      bullets.push('High-quality flow data with clear institutional intent');
      confidence += 5;
    } else if (totals.classificationRate < 50) {
      bullets.push('Flow data quality limited - lower confidence in interpretation');
      confidence -= 10;
    }
    
    confidence = Math.max(0, Math.min(100, confidence));
    
    return {
      bullets: bullets.slice(0, 6), // Max 6 bullets
      confidence: Math.round(confidence)
    };
  }
}

module.exports = ReportBuilder;
