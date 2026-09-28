export const ANALYTICS_PERIODS = [1, 7, 30] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
