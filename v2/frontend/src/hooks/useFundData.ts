// Client-side fallback data - works even without backend
import { useMemo } from "react";

const managersData = [
  { id: 1, name: "张坤", gender: "male", education: "硕士", careerStart: "2008-07-01", manageYears: "12.50", totalScale: "654.32", fundCount: 4, company: "易方达基金", investmentStyle: "大盘成长,价值投资", philosophy: "坚持价值投资，寻找具有长期竞争优势的龙头企业", styleDescription: "张坤的投资风格以深度价值投资为核心，偏好大盘成长股。他具有极强的选股能力和持股定力，换手率极低，善于发现具有宽护城河的消费龙头。", bestReturn: "95.09", worstReturn: "-28.56" },
  { id: 2, name: "朱少醒", gender: "male", education: "博士", careerStart: "2000-06-01", manageYears: "15.80", totalScale: "326.78", fundCount: 2, company: "富国基金", investmentStyle: "均衡配置,长期持有", philosophy: "自下而上精选个股，均衡配置，长期持有", styleDescription: "朱少醒是典型的均衡型选手，不押注单一赛道，而是通过广泛的行业覆盖和深入的个股研究来获取alpha。", bestReturn: "112.34", worstReturn: "-22.18" },
  { id: 3, name: "谢治宇", gender: "male", education: "硕士", careerStart: "2007-06-01", manageYears: "10.20", totalScale: "412.56", fundCount: 4, company: "兴证全球基金", investmentStyle: "均衡成长,价值发现", philosophy: "在控制回撤的前提下追求长期稳健收益", styleDescription: "谢治宇以稳健著称，其投资框架强调安全边际与成长性的平衡，在回撤控制上表现优异。", bestReturn: "88.76", worstReturn: "-19.34" },
  { id: 4, name: "刘格菘", gender: "male", education: "博士", careerStart: "2010-07-01", manageYears: "9.50", totalScale: "523.41", fundCount: 6, company: "广发基金", investmentStyle: "科技成长,行业集中", philosophy: "聚焦景气度向上的行业，在优质赛道中精选龙头", styleDescription: "刘格菘是科技成长赛道的代表性基金经理，擅长产业链研究和景气度判断，在科技、新能源等成长行情中表现突出。", bestReturn: "108.92", worstReturn: "-35.67" },
  { id: 5, name: "葛兰", gender: "female", education: "博士", careerStart: "2011-07-01", manageYears: "8.80", totalScale: "789.45", fundCount: 5, company: "中欧基金", investmentStyle: "医药成长,深度研究", philosophy: "深耕医药行业，自下而上精选具有创新能力的医药企业", styleDescription: "葛兰是国内医药投资领域的权威专家，具有医学博士背景，持仓高度集中于医药行业，在医药牛市中爆发力极强。", bestReturn: "156.78", worstReturn: "-42.13" },
  { id: 6, name: "傅鹏博", gender: "male", education: "硕士", careerStart: "1998-03-01", manageYears: "18.50", totalScale: "234.56", fundCount: 2, company: "睿远基金", investmentStyle: "精选个股,长期持有", philosophy: "聚焦企业核心竞争力，陪伴优秀企业成长", styleDescription: "傅鹏博是业内资历最深的基金经理之一，以精选个股、长期投资闻名，换手率在全行业处于最低水平。", bestReturn: "134.56", worstReturn: "-25.34" },
  { id: 7, name: "刘彦春", gender: "male", education: "硕士", careerStart: "2005-03-01", manageYears: "12.80", totalScale: "567.89", fundCount: 6, company: "景顺长城基金", investmentStyle: "消费成长,龙头集中", philosophy: "重仓消费龙头，分享消费升级红利", styleDescription: "刘彦春是消费赛道的资深玩家，偏好白酒、家电、医药等消费细分领域龙头，是消费升级主题投资的核心配置选择。", bestReturn: "102.34", worstReturn: "-31.45" },
  { id: 8, name: "胡昕炜", gender: "male", education: "硕士", careerStart: "2011-07-01", manageYears: "8.50", totalScale: "298.45", fundCount: 8, company: "汇添富基金", investmentStyle: "消费价值,品质投资", philosophy: "投资于中国经济转型中的消费升级机会", styleDescription: "胡昕炜的投资风格兼顾消费成长与价值发现，在消费行业内部灵活切换，更注重估值安全边际。", bestReturn: "92.34", worstReturn: "-24.56" },
  { id: 9, name: "赵诣", gender: "male", education: "硕士", careerStart: "2014-10-01", manageYears: "6.80", totalScale: "187.65", fundCount: 4, company: "泉果基金", investmentStyle: "高端制造,产业深耕", philosophy: "深耕新能源与高端制造领域", styleDescription: "赵诣是新生代基金经理中的明星，以在新能源领域的精准布局而闻名，在新能源景气上行期表现极为突出。", bestReturn: "167.89", worstReturn: "-38.92" },
  { id: 10, name: "丘栋荣", gender: "male", education: "硕士", careerStart: "2010-09-01", manageYears: "9.20", totalScale: "156.78", fundCount: 4, company: "中庚基金", investmentStyle: "低估值,价值发现", philosophy: "坚持低估值价值投资策略", styleDescription: "丘栋荣是低估值价值投资的坚定践行者，基于PB-ROE模型系统性地寻找低估值高盈利质量的标的。", bestReturn: "56.78", worstReturn: "-12.34" },
  { id: 11, name: "周蔚文", gender: "male", education: "硕士", careerStart: "2000-09-01", manageYears: "16.20", totalScale: "345.67", fundCount: 5, company: "中欧基金", investmentStyle: "均衡配置,周期把握", philosophy: "自上而下判断宏观周期，行业间灵活切换", styleDescription: "周蔚文是宏观策略型选手，擅长结合宏观经济周期进行行业配置，在行业轮动方面表现出色。", bestReturn: "89.12", worstReturn: "-18.76" },
];

const fundsData = [
  { id: 1, fundCode: "110011", fundName: "易方达中小盘混合型证券投资基金", fundAbbr: "易方达中小盘", fundType: "hybrid", category: "大盘成长", company: "易方达基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "4.8567", accumNav: "5.1234", dailyChange: "1.23", totalScale: "156.78", benchmark: "中证500指数收益率x60%+上证国债指数收益率x40%", investStrategy: "投资于具有持续成长能力的中小盘股票", feeManage: "0.0150", feeCustody: "0.0025", stars: 5, managerId: 1, tags: ["AI优选", "长跑冠军"], trackingIndex: null },
  { id: 2, fundCode: "161005", fundName: "富国天惠精选成长混合型证券投资基金", fundAbbr: "富国天惠成长", fundType: "hybrid", category: "均衡配置", company: "富国基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "3.2145", accumNav: "7.8923", dailyChange: "0.89", totalScale: "298.45", benchmark: "沪深300指数收益率x60%+中债综合指数收益率x40%", investStrategy: "通过精选具有持续成长潜力的上市公司", feeManage: "0.0150", feeCustody: "0.0025", stars: 5, managerId: 2, tags: ["攻守兼备", "十年金牛"], trackingIndex: null },
  { id: 3, fundCode: "163406", fundName: "兴全合润分级混合型证券投资基金", fundAbbr: "兴全合润", fundType: "hybrid", category: "均衡成长", company: "兴证全球基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.8934", accumNav: "4.5678", dailyChange: "-0.45", totalScale: "234.56", benchmark: "沪深300指数收益率x70%+上证国债指数收益率x30%", investStrategy: "在控制风险的前提下，追求长期稳定的投资回报", feeManage: "0.0150", feeCustody: "0.0025", stars: 5, managerId: 3, tags: ["稳健增长", "回撤修复快"], trackingIndex: null },
  { id: 4, fundCode: "002939", fundName: "广发创新升级灵活配置混合型证券投资基金", fundAbbr: "广发创新升级", fundType: "hybrid", category: "科技成长", company: "广发基金", riskLevel: "high", isContinuousMarketing: 1, nav: "2.4567", accumNav: "3.1234", dailyChange: "2.34", totalScale: "187.65", benchmark: "中证500指数收益率x50%+中证全债指数收益率x50%", investStrategy: "重点布局科技创新领域", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 4, tags: ["科技龙头", "高弹性"], trackingIndex: null },
  { id: 5, fundCode: "003095", fundName: "中欧医疗健康混合型证券投资基金A类", fundAbbr: "中欧医疗健康A", fundType: "equity", category: "医药主题", company: "中欧基金", riskLevel: "high", isContinuousMarketing: 1, nav: "2.7891", accumNav: "2.7891", dailyChange: "-1.23", totalScale: "345.67", benchmark: "中证医药卫生指数收益率x60%+中证综合债券指数收益率x40%", investStrategy: "深耕医疗健康行业", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 5, tags: ["医药龙头", "创新驱动"], trackingIndex: null },
  { id: 6, fundCode: "110022", fundName: "易方达消费行业股票型证券投资基金", fundAbbr: "易方达消费行业", fundType: "equity", category: "消费主题", company: "易方达基金", riskLevel: "high", isContinuousMarketing: 1, nav: "3.6789", accumNav: "3.6789", dailyChange: "1.56", totalScale: "234.56", benchmark: "中证内地消费主题指数收益率x85%+中债总指数收益率x15%", investStrategy: "重点投资于消费行业中的龙头企业", feeManage: "0.0150", feeCustody: "0.0025", stars: 5, managerId: 1, tags: ["消费升级", "品牌护城河"], trackingIndex: null },
  { id: 7, fundCode: "260108", fundName: "景顺长城新兴成长混合型证券投资基金", fundAbbr: "景顺长城新兴成长", fundType: "hybrid", category: "消费成长", company: "景顺长城基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "2.3456", accumNav: "3.7890", dailyChange: "0.78", totalScale: "312.45", benchmark: "中证800成长指数收益率x70%+银行同业存款利率x30%", investStrategy: "投资于新兴成长行业", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 7, tags: ["消费龙头", "长期持有"], trackingIndex: null },
  { id: 8, fundCode: "000083", fundName: "汇添富消费行业混合型证券投资基金", fundAbbr: "汇添富消费行业", fundType: "hybrid", category: "消费价值", company: "汇添富基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "4.1234", accumNav: "4.1234", dailyChange: "1.12", totalScale: "156.78", benchmark: "中证主要消费行业指数收益率x70%+上证国债指数收益率x30%", investStrategy: "聚焦消费行业", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 8, tags: ["品质消费", "稳健增长"], trackingIndex: null },
  { id: 9, fundCode: "007119", fundName: "睿远成长价值混合型证券投资基金A类", fundAbbr: "睿远成长价值A", fundType: "hybrid", category: "精选个股", company: "睿远基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.6789", accumNav: "1.6789", dailyChange: "-0.67", totalScale: "298.45", benchmark: "中证800指数收益率x50%+中证港股通综合指数收益率x20%+上证国债指数收益率x30%", investStrategy: "自下而上精选具有核心竞争力的优质企业", feeManage: "0.0120", feeCustody: "0.0020", stars: 4, managerId: 6, tags: ["价值投资", "精品策略"], trackingIndex: null },
  { id: 10, fundCode: "005911", fundName: "广发双擎升级混合型证券投资基金A类", fundAbbr: "广发双擎升级A", fundType: "hybrid", category: "科技成长", company: "广发基金", riskLevel: "high", isContinuousMarketing: 1, nav: "3.4567", accumNav: "3.4567", dailyChange: "2.78", totalScale: "123.45", benchmark: "中证500指数收益率x60%+中证全债指数收益率x40%", investStrategy: "在新能源和科技领域精选龙头", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 4, tags: ["新能源", "产业升级"], trackingIndex: null },
  { id: 11, fundCode: "001938", fundName: "中欧时代先锋股票型发起式证券投资基金A类", fundAbbr: "中欧时代先锋A", fundType: "equity", category: "均衡配置", company: "中欧基金", riskLevel: "high", isContinuousMarketing: 0, nav: "1.5678", accumNav: "2.3456", dailyChange: "0.34", totalScale: "89.12", benchmark: "沪深300指数收益率x80%+中债综合指数收益率x20%", investStrategy: "寻找时代变革中的投资机遇", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 11, tags: ["时代先锋", "产业升级"], trackingIndex: null },
  { id: 12, fundCode: "010805", fundName: "泉果旭源三年持有期混合型证券投资基金A类", fundAbbr: "泉果旭源三年持有A", fundType: "hybrid", category: "高端制造", company: "泉果基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "0.9876", accumNav: "0.9876", dailyChange: "1.34", totalScale: "89.45", benchmark: "中证800指数收益率x50%+中证港股通综合指数收益率x20%+中债综合指数收益率x30%", investStrategy: "聚焦高端制造和新能源领域", feeManage: "0.0120", feeCustody: "0.0020", stars: 3, managerId: 9, tags: ["高端制造", "新能源"], trackingIndex: null },
  { id: 13, fundCode: "007130", fundName: "中庚小盘价值股票型证券投资基金", fundAbbr: "中庚小盘价值", fundType: "equity", category: "小盘价值", company: "中庚基金", riskLevel: "high", isContinuousMarketing: 1, nav: "2.3456", accumNav: "2.5678", dailyChange: "0.23", totalScale: "67.89", benchmark: "中证1000指数收益率x90%+上证国债指数收益率x10%", investStrategy: "坚持低估值价值投资", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 10, tags: ["低估值", "小盘精品"], trackingIndex: null },
  { id: 14, fundCode: "110003", fundName: "易方达上证50指数增强型证券投资基金A类", fundAbbr: "易方达上证50指数增强A", fundType: "index", category: "大盘指数", company: "易方达基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.5678", accumNav: "3.4567", dailyChange: "0.45", totalScale: "234.56", benchmark: "上证50指数收益率x95%+活期存款利率x5%", investStrategy: "在跟踪上证50指数的基础上，通过量化增强策略获取超额收益", feeManage: "0.0100", feeCustody: "0.0020", stars: 4, managerId: null, tags: ["指数增强", "大盘蓝筹"], trackingIndex: "上证50指数" },
  { id: 15, fundCode: "001051", fundName: "华夏沪深300交易型开放式指数证券投资基金联接基金A类", fundAbbr: "华夏沪深300ETF联接A", fundType: "index", category: "宽基指数", company: "华夏基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.3456", accumNav: "1.6789", dailyChange: "0.56", totalScale: "456.78", benchmark: "沪深300指数收益率x95%+活期存款利率x5%", investStrategy: "跟踪沪深300指数", feeManage: "0.0050", feeCustody: "0.0010", stars: 4, managerId: null, tags: ["宽基指数", "核心配置"], trackingIndex: "沪深300指数" },
  { id: 16, fundCode: "217010", fundName: "招商中证白酒指数证券投资基金A类", fundAbbr: "招商中证白酒指数A", fundType: "index", category: "消费指数", company: "招商基金", riskLevel: "high", isContinuousMarketing: 1, nav: "1.0987", accumNav: "2.3456", dailyChange: "1.89", totalScale: "567.89", benchmark: "中证白酒指数收益率x95%+银行活期存款利率x5%", investStrategy: "跟踪中证白酒指数", feeManage: "0.0100", feeCustody: "0.0020", stars: 4, managerId: null, tags: ["白酒龙头", "消费核心"], trackingIndex: "中证白酒指数" },
  { id: 17, fundCode: "001968", fundName: "工银瑞信全球精选混合型证券投资基金(QDII)", fundAbbr: "工银全球精选", fundType: "qdii", category: "全球配置", company: "工银瑞信基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.5678", accumNav: "1.7890", dailyChange: "0.67", totalScale: "34.56", benchmark: "MSCI全球指数收益率x60%+恒生指数收益率x20%+中债综合指数收益率x20%", investStrategy: "全球资产配置", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: null, tags: ["全球配置", "分散风险"], trackingIndex: null },
  { id: 18, fundCode: "001987", fundName: "南方全天候策略混合型证券投资基金(FOF)A类", fundAbbr: "南方全天候策略A", fundType: "fof", category: "全天候策略", company: "南方基金", riskLevel: "medium", isContinuousMarketing: 1, nav: "1.3456", accumNav: "1.4567", dailyChange: "0.12", totalScale: "89.45", benchmark: "中证偏股型基金指数收益率x30%+中债综合指数收益率x70%", investStrategy: "运用全天候策略", feeManage: "0.0080", feeCustody: "0.0020", stars: 4, managerId: null, tags: ["全天候", "资产配置"], trackingIndex: null },
  { id: 19, fundCode: "007749", fundName: "中庚价值领航混合型证券投资基金", fundAbbr: "中庚价值领航", fundType: "hybrid", category: "价值投资", company: "中庚基金", riskLevel: "medium_high", isContinuousMarketing: 1, nav: "1.8765", accumNav: "2.1234", dailyChange: "0.45", totalScale: "98.76", benchmark: "中证800指数收益率x50%+上证国债指数收益率x50%", investStrategy: "坚持低估值价值投资", feeManage: "0.0150", feeCustody: "0.0025", stars: 4, managerId: 10, tags: ["低估值", "价值发现"], trackingIndex: null },
];

const performanceData = [
  { fundId: 1, return1m: "2.34", return3m: "5.67", return6m: "8.92", return1y: "15.23", return2y: "28.45", return3y: "42.18", return5y: "78.56", returnThisYear: "6.78", annualizedReturn: "12.45", annualizedVolatility: "18.32", sharpeRatio: "0.82", maxDrawdown: "-22.34", calmarRatio: "0.56", sortinoRatio: "1.12", informationRatio: "0.78", alpha: "5.23", beta: "0.92", winRate: "54.32", recoveryPeriod: 156 },
  { fundId: 2, return1m: "1.89", return3m: "4.56", return6m: "7.34", return1y: "12.78", return2y: "25.67", return3y: "38.92", return5y: "72.34", returnThisYear: "5.45", annualizedReturn: "11.23", annualizedVolatility: "16.78", sharpeRatio: "0.78", maxDrawdown: "-19.56", calmarRatio: "0.57", sortinoRatio: "1.05", informationRatio: "0.65", alpha: "4.12", beta: "0.88", winRate: "56.78", recoveryPeriod: 134 },
  { fundId: 3, return1m: "-0.45", return3m: "3.21", return6m: "6.78", return1y: "11.23", return2y: "22.45", return3y: "35.67", return5y: "65.89", returnThisYear: "4.32", annualizedReturn: "10.56", annualizedVolatility: "15.23", sharpeRatio: "0.85", maxDrawdown: "-16.78", calmarRatio: "0.63", sortinoRatio: "1.18", informationRatio: "0.72", alpha: "4.89", beta: "0.85", winRate: "58.92", recoveryPeriod: 112 },
  { fundId: 4, return1m: "3.12", return3m: "8.45", return6m: "12.34", return1y: "22.56", return2y: "38.92", return3y: "55.67", return5y: "92.34", returnThisYear: "9.87", annualizedReturn: "16.78", annualizedVolatility: "22.34", sharpeRatio: "0.88", maxDrawdown: "-28.92", calmarRatio: "0.58", sortinoRatio: "1.25", informationRatio: "0.92", alpha: "7.34", beta: "1.05", winRate: "52.34", recoveryPeriod: 189 },
  { fundId: 5, return1m: "-1.23", return3m: "2.34", return6m: "4.56", return1y: "8.92", return2y: "18.34", return3y: "32.56", return5y: "68.92", returnThisYear: "3.21", annualizedReturn: "9.78", annualizedVolatility: "24.56", sharpeRatio: "0.52", maxDrawdown: "-35.67", calmarRatio: "0.27", sortinoRatio: "0.78", informationRatio: "0.45", alpha: "3.12", beta: "1.12", winRate: "48.92", recoveryPeriod: 234 },
  { fundId: 6, return1m: "2.78", return3m: "6.12", return6m: "9.45", return1y: "16.78", return2y: "30.23", return3y: "45.67", return5y: "82.34", returnThisYear: "7.56", annualizedReturn: "13.45", annualizedVolatility: "19.56", sharpeRatio: "0.80", maxDrawdown: "-24.56", calmarRatio: "0.55", sortinoRatio: "1.08", informationRatio: "0.82", alpha: "5.67", beta: "0.95", winRate: "53.45", recoveryPeriod: 167 },
  { fundId: 7, return1m: "1.56", return3m: "4.89", return6m: "7.89", return1y: "13.45", return2y: "26.78", return3y: "40.12", return5y: "75.67", returnThisYear: "5.89", annualizedReturn: "11.78", annualizedVolatility: "17.89", sharpeRatio: "0.76", maxDrawdown: "-21.34", calmarRatio: "0.55", sortinoRatio: "1.02", informationRatio: "0.68", alpha: "4.56", beta: "0.90", winRate: "55.67", recoveryPeriod: 145 },
  { fundId: 8, return1m: "2.12", return3m: "5.34", return6m: "8.23", return1y: "14.56", return2y: "27.89", return3y: "41.23", return5y: "76.89", returnThisYear: "6.34", annualizedReturn: "12.12", annualizedVolatility: "18.12", sharpeRatio: "0.79", maxDrawdown: "-20.78", calmarRatio: "0.58", sortinoRatio: "1.06", informationRatio: "0.75", alpha: "4.78", beta: "0.93", winRate: "54.78", recoveryPeriod: 152 },
  { fundId: 9, return1m: "-0.67", return3m: "2.78", return6m: "5.67", return1y: "10.34", return2y: "20.56", return3y: "33.78", return5y: "62.34", returnThisYear: "4.56", annualizedReturn: "10.23", annualizedVolatility: "16.34", sharpeRatio: "0.72", maxDrawdown: "-18.92", calmarRatio: "0.54", sortinoRatio: "0.98", informationRatio: "0.62", alpha: "3.89", beta: "0.87", winRate: "55.23", recoveryPeriod: 128 },
  { fundId: 10, return1m: "3.45", return3m: "7.89", return6m: "11.23", return1y: "20.34", return2y: "35.67", return3y: "52.34", return5y: "88.92", returnThisYear: "8.78", annualizedReturn: "15.23", annualizedVolatility: "23.45", sharpeRatio: "0.82", maxDrawdown: "-30.12", calmarRatio: "0.51", sortinoRatio: "1.18", informationRatio: "0.88", alpha: "6.78", beta: "1.08", winRate: "51.23", recoveryPeriod: 198 },
  { fundId: 11, return1m: "0.89", return3m: "3.45", return6m: "6.12", return1y: "11.23", return2y: "23.45", return3y: "36.78", return5y: "68.92", returnThisYear: "4.89", annualizedReturn: "10.89", annualizedVolatility: "19.56", sharpeRatio: "0.68", maxDrawdown: "-23.45", calmarRatio: "0.46", sortinoRatio: "0.92", informationRatio: "0.58", alpha: "3.45", beta: "0.96", winRate: "50.12", recoveryPeriod: 156 },
  { fundId: 12, return1m: "2.34", return3m: "5.67", return6m: "9.12", return1y: "17.89", return2y: "32.34", return3y: "48.92", return5y: "85.67", returnThisYear: "7.23", annualizedReturn: "14.12", annualizedVolatility: "21.34", sharpeRatio: "0.79", maxDrawdown: "-26.78", calmarRatio: "0.53", sortinoRatio: "1.08", informationRatio: "0.78", alpha: "5.89", beta: "1.02", winRate: "52.78", recoveryPeriod: 178 },
  { fundId: 13, return1m: "0.45", return3m: "2.12", return6m: "4.78", return1y: "9.56", return2y: "19.34", return3y: "31.23", return5y: "58.92", returnThisYear: "3.89", annualizedReturn: "9.34", annualizedVolatility: "20.12", sharpeRatio: "0.55", maxDrawdown: "-25.34", calmarRatio: "0.37", sortinoRatio: "0.82", informationRatio: "0.42", alpha: "3.23", beta: "1.01", winRate: "49.56", recoveryPeriod: 167 },
  { fundId: 14, return1m: "0.78", return3m: "2.34", return6m: "4.56", return1y: "8.92", return2y: "17.78", return3y: "28.92", return5y: "55.34", returnThisYear: "3.45", annualizedReturn: "8.78", annualizedVolatility: "17.23", sharpeRatio: "0.58", maxDrawdown: "-20.34", calmarRatio: "0.43", sortinoRatio: "0.85", informationRatio: "0.38", alpha: "2.12", beta: "0.95", winRate: "51.34", recoveryPeriod: 145 },
  { fundId: 15, return1m: "0.92", return3m: "2.67", return6m: "5.12", return1y: "9.78", return2y: "19.56", return3y: "31.34", return5y: "60.23", returnThisYear: "3.78", annualizedReturn: "9.45", annualizedVolatility: "16.89", sharpeRatio: "0.62", maxDrawdown: "-19.56", calmarRatio: "0.48", sortinoRatio: "0.88", informationRatio: "0.42", alpha: "2.67", beta: "0.93", winRate: "52.67", recoveryPeriod: 134 },
  { fundId: 16, return1m: "3.12", return3m: "6.78", return6m: "10.23", return1y: "18.92", return2y: "33.45", return3y: "50.23", return5y: "92.34", returnThisYear: "8.12", annualizedReturn: "14.56", annualizedVolatility: "24.78", sharpeRatio: "0.72", maxDrawdown: "-32.56", calmarRatio: "0.45", sortinoRatio: "1.02", informationRatio: "0.68", alpha: "5.34", beta: "1.08", winRate: "50.23", recoveryPeriod: 198 },
  { fundId: 17, return1m: "1.23", return3m: "3.89", return6m: "6.78", return1y: "12.34", return2y: "24.56", return3y: "38.92", return5y: "72.34", returnThisYear: "5.12", annualizedReturn: "11.23", annualizedVolatility: "15.67", sharpeRatio: "0.78", maxDrawdown: "-18.92", calmarRatio: "0.59", sortinoRatio: "1.08", informationRatio: "0.72", alpha: "4.23", beta: "0.82", winRate: "54.56", recoveryPeriod: 134 },
  { fundId: 18, return1m: "0.34", return3m: "1.23", return6m: "2.67", return1y: "5.78", return2y: "11.34", return3y: "18.92", return5y: "36.78", returnThisYear: "2.34", annualizedReturn: "5.89", annualizedVolatility: "8.92", sharpeRatio: "0.65", maxDrawdown: "-12.34", calmarRatio: "0.48", sortinoRatio: "0.92", informationRatio: "0.45", alpha: "2.34", beta: "0.45", winRate: "55.78", recoveryPeriod: 98 },
  { fundId: 19, return1m: "1.12", return3m: "3.45", return6m: "6.12", return1y: "11.23", return2y: "22.34", return3y: "35.67", return5y: "65.89", returnThisYear: "4.78", annualizedReturn: "10.56", annualizedVolatility: "17.89", sharpeRatio: "0.68", maxDrawdown: "-19.78", calmarRatio: "0.53", sortinoRatio: "0.95", informationRatio: "0.58", alpha: "3.78", beta: "0.88", winRate: "52.34", recoveryPeriod: 145 },
];

const recommendationsData = [
  { id: 1, name: "稳健型核心组合", description: "适合风险偏好较低的投资者", riskProfile: "conservative", marketCondition: "震荡市/熊市", expectedReturn: "6.50", expectedRisk: "5.20", rationale: "该组合以债券基金为核心配置（50%），辅以低波动权益基金（30%）和固收+（20%），在控制回撤的前提下获取稳健收益。", tags: ["低风险", "稳健收益", "适合新手"], fundAllocations: [{ fundId: 19, weight: 35, reason: "低估值价值投资" }, { fundId: 3, weight: 25, reason: "均衡配置" }, { fundId: 18, weight: 20, reason: "全天候策略" }, { fundId: 14, weight: 12, reason: "大盘蓝筹" }, { fundId: 15, weight: 8, reason: "宽基指数" }] },
  { id: 2, name: "均衡增长组合", description: "适合风险承受能力中等的投资者", riskProfile: "balanced", marketCondition: "全市场周期", expectedReturn: "10.80", expectedRisk: "12.50", rationale: "采用60%权益+40%固收的经典配置，通过精选主动管理型基金经理获取超额收益。", tags: ["均衡配置", "长期持有", "核心卫星"], fundAllocations: [{ fundId: 1, weight: 25, reason: "消费龙头" }, { fundId: 5, weight: 20, reason: "医药创新" }, { fundId: 9, weight: 20, reason: "精选个股" }, { fundId: 3, weight: 20, reason: "均衡配置" }, { fundId: 15, weight: 15, reason: "分散风险" }] },
  { id: 3, name: "科技成长先锋组合", description: "适合追求高收益的投资者", riskProfile: "aggressive", marketCondition: "牛市/结构性行情", expectedReturn: "18.50", expectedRisk: "22.30", rationale: "集中配置于科技成长赛道（70%），包括新能源、半导体、AI等方向。", tags: ["高成长", "科技赛道", "长期布局"], fundAllocations: [{ fundId: 4, weight: 30, reason: "科技成长" }, { fundId: 10, weight: 25, reason: "新能源" }, { fundId: 6, weight: 20, reason: "消费升级" }, { fundId: 12, weight: 15, reason: "高端制造" }, { fundId: 17, weight: 10, reason: "全球配置" }] },
  { id: 4, name: "价值发现组合", description: "基于低估值策略", riskProfile: "moderate", marketCondition: "估值修复期", expectedReturn: "12.30", expectedRisk: "10.80", rationale: "践行格雷厄姆式价值投资理念，精选低估值、高股息的大中盘股票。", tags: ["价值投资", "低估值", "逆向布局"], fundAllocations: [{ fundId: 19, weight: 30, reason: "深度价值" }, { fundId: 13, weight: 25, reason: "小盘价值" }, { fundId: 2, weight: 25, reason: "均衡成长" }, { fundId: 14, weight: 20, reason: "大盘蓝筹" }] },
  { id: 5, name: "全球配置组合", description: "全球化资产配置", riskProfile: "balanced", marketCondition: "全球经济复苏", expectedReturn: "9.20", expectedRisk: "11.50", rationale: "将资产配置于中国A股、港股、美股和新兴市场，通过QDII基金实现全球化布局。", tags: ["全球配置", "分散风险", "QDII"], fundAllocations: [{ fundId: 17, weight: 25, reason: "全球精选" }, { fundId: 9, weight: 20, reason: "高端制造" }, { fundId: 6, weight: 20, reason: "消费升级" }, { fundId: 1, weight: 20, reason: "成长核心" }, { fundId: 18, weight: 15, reason: "稳定器" }] },
];

const backtestsData = [
  { id: 1, name: "易方达中小盘月度定投回测", type: "single", fundIds: [1], weights: [100], strategy: "fixed_amount", startDate: "2022-01-01", endDate: "2025-05-15", investAmount: "1000.00", investFrequency: "monthly", totalInvested: "41000.00", finalValue: "52346.78", totalReturn: "27.67", annualizedReturn: "8.34", maxDrawdown: "-18.56", sharpeRatio: "0.78", benchmarkReturn: "15.23", excessReturn: "12.44" },
  { id: 2, name: "消费+医药组合周定投回测", type: "portfolio", fundIds: [6, 5], weights: [60, 40], strategy: "value_averaging", startDate: "2023-01-01", endDate: "2025-05-15", investAmount: "2000.00", investFrequency: "weekly", totalInvested: "128000.00", finalValue: "156789.23", totalReturn: "22.49", annualizedReturn: "9.12", maxDrawdown: "-15.34", sharpeRatio: "0.89", benchmarkReturn: "12.45", excessReturn: "9.96" },
  { id: 3, name: "兴全合润智能Beta定投回测", type: "single", fundIds: [3], weights: [100], strategy: "smart_beta", startDate: "2022-06-01", endDate: "2025-05-15", investAmount: "1500.00", investFrequency: "biweekly", totalInvested: "54000.00", finalValue: "68723.45", totalReturn: "27.27", annualizedReturn: "8.92", maxDrawdown: "-12.78", sharpeRatio: "0.95", benchmarkReturn: "18.34", excessReturn: "8.93" },
  { id: 4, name: "科技成长组合马丁策略回测", type: "portfolio", fundIds: [4, 10, 12], weights: [40, 35, 25], strategy: "martingale", startDate: "2023-03-01", endDate: "2025-05-15", investAmount: "3000.00", investFrequency: "monthly", totalInvested: "81000.00", finalValue: "102345.67", totalReturn: "26.35", annualizedReturn: "11.56", maxDrawdown: "-22.34", sharpeRatio: "0.72", benchmarkReturn: "20.12", excessReturn: "6.23" },
];

const industries = ["食品饮料", "医药生物", "电子", "电力设备", "银行", "非银金融", "计算机", "汽车", "家用电器"];

function getIndustryAlloc(fundId: number) {
  const shuffled = [...industries].sort(() => 0.5 - Math.abs(Math.sin(fundId * 123.456)));
  const selected = shuffled.slice(0, 4 + (fundId % 3));
  let remaining = 100;
  return selected.map((ind, i) => {
    const isLast = i === selected.length - 1;
    const ratio = isLast ? remaining : Math.floor(15 + Math.abs(Math.sin(fundId * i * 17.3)) * 25);
    remaining -= ratio;
    return { fundId, industry: ind, ratio: (ratio / 100).toFixed(4), changeRatio: (Math.sin(fundId * i * 7.89) * 3).toFixed(4), quarter: "2024Q4" };
  });
}

const stocks = [
  { code: "600519", name: "贵州茅台", industry: "食品饮料" },
  { code: "000858", name: "五粮液", industry: "食品饮料" },
  { code: "600036", name: "招商银行", industry: "银行" },
  { code: "601318", name: "中国平安", industry: "非银金融" },
  { code: "000333", name: "美的集团", industry: "家用电器" },
  { code: "300750", name: "宁德时代", industry: "电力设备" },
  { code: "002415", name: "海康威视", industry: "计算机" },
  { code: "600276", name: "恒瑞医药", industry: "医药生物" },
  { code: "002594", name: "比亚迪", industry: "汽车" },
  { code: "000651", name: "格力电器", industry: "家用电器" },
  { code: "000568", name: "泸州老窖", industry: "食品饮料" },
  { code: "002304", name: "洋河股份", industry: "食品饮料" },
];

function getHoldings(fundId: number) {
  const shuffled = [...stocks].sort(() => 0.5 - Math.abs(Math.sin(fundId * 789.123)));
  const selected = shuffled.slice(0, 5 + (fundId % 4));
  return selected.map((s, i) => ({
    fundId, stockCode: s.code, stockName: s.name, industry: s.industry,
    ratio: (3 + Math.abs(Math.sin(fundId * i * 13.7)) * 7).toFixed(4),
    changeRatio: (Math.sin(fundId * i * 5.3) * 2).toFixed(4),
    quarter: "2024Q4",
  }));
}

function generateNavHistory(fundId: number, baseNav: number) {
  const history: { navDate: string; nav: string; dailyReturn: string }[] = [];
  let currentNav = baseNav * 0.65;
  const startDate = new Date("2023-01-04");
  const endDate = new Date("2025-05-15");
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    const seed = fundId * 1000 + d.getTime() / 86400000;
    const dailyReturn = (Math.sin(seed * 0.1) * 0.008 + Math.cos(seed * 0.05) * 0.005 + (Math.random() - 0.48) * 0.006);
    currentNav *= 1 + dailyReturn;
    if (currentNav < baseNav * 0.4) currentNav = baseNav * 0.45;
    if (currentNav > baseNav * 1.5) currentNav = baseNav * 1.45;
    history.push({ navDate: d.toISOString().split("T")[0], nav: currentNav.toFixed(4), dailyReturn: (dailyReturn * 100).toFixed(4) });
  }
  return history;
}

// Helper functions
export function getEnrichedFunds() {
  return fundsData.map((f) => {
    const perf = performanceData.find((p) => p.fundId === f.id);
    const mgr = managersData.find((m) => m.id === f.managerId);
    return { ...f, performance: perf || null, manager: mgr || null };
  });
}

export function getFundDetail(fundId: number) {
  const fund = fundsData.find((f) => f.id === fundId);
  if (!fund) return null;
  const perf = performanceData.find((p) => p.fundId === fundId);
  const mgr = managersData.find((m) => m.id === fund.managerId);
  const indAlloc = getIndustryAlloc(fundId);
  const holdings = fund.fundType !== "index" ? getHoldings(fundId) : [];
  const navHistory = generateNavHistory(fundId, parseFloat(fund.nav || "1"));
  return { ...fund, performance: perf || null, manager: mgr || null, industries: indAlloc, holdings, navHistory: navHistory.slice(-120) };
}

export function getManagerDetail(managerId: number) {
  const mgr = managersData.find((m) => m.id === managerId);
  if (!mgr) return null;
  const managedFunds = fundsData.filter((f) => f.managerId === managerId).map((f) => {
    const perf = performanceData.find((p) => p.fundId === f.id);
    return { ...f, performance: perf };
  });
  return { ...mgr, funds: managedFunds };
}

export function getFilterOptions() {
  const types = [...new Set(fundsData.map((f) => f.fundType))];
  const categories = [...new Set(fundsData.map((f) => f.category).filter(Boolean))];
  const companies = [...new Set(fundsData.map((f) => f.company).filter(Boolean))];
  const riskLevels = [...new Set(fundsData.map((f) => f.riskLevel).filter(Boolean))];
  return { types, categories, companies, riskLevels };
}

export function getContinuousMarketing() {
  return getEnrichedFunds().filter((f) => f.isContinuousMarketing === 1);
}

export function getRecommendations(riskProfile?: string) {
  let result = recommendationsData.map((r) => ({
    ...r,
    fundDetails: r.fundAllocations.map((fa: any) => {
      const fund = fundsData.find((f) => f.id === fa.fundId);
      return { ...fa, fund };
    }),
  }));
  if (riskProfile) result = result.filter((r) => r.riskProfile === riskProfile);
  return result;
}

export function getBacktests() {
  return backtestsData.map((bt) => ({
    ...bt,
    fundDetails: bt.fundIds.map((fid, i) => {
      const fund = fundsData.find((f) => f.id === fid);
      return { fund, weight: bt.weights[i] || 100 };
    }),
  }));
}

export function getIndustryStats() {
  const stats: Record<string, number> = {};
  fundsData.forEach((f) => {
    const alloc = getIndustryAlloc(f.id);
    alloc.forEach((a) => {
      stats[a.industry] = (stats[a.industry] || 0) + parseFloat(a.ratio);
    });
  });
  return Object.entries(stats)
    .map(([industry, totalRatio]) => ({ industry, totalRatio: (totalRatio / fundsData.length * 100).toFixed(2) }))
    .sort((a, b) => parseFloat(b.totalRatio) - parseFloat(a.totalRatio));
}

export function getMarketOverview() {
  const totalFunds = fundsData.length;
  const avgReturn = (performanceData.reduce((sum, p) => sum + parseFloat(p.return1y || "0"), 0) / performanceData.length).toFixed(2);
  const avgSharpe = (performanceData.reduce((sum, p) => sum + parseFloat(p.sharpeRatio || "0"), 0) / performanceData.length).toFixed(2);
  const avgMaxDD = (performanceData.reduce((sum, p) => sum + parseFloat(p.maxDrawdown || "0"), 0) / performanceData.length).toFixed(2);
  const marketingCount = fundsData.filter((f) => f.isContinuousMarketing === 1).length;
  return { totalFunds, avgReturn, avgSharpe, avgMaxDD, marketingCount };
}
