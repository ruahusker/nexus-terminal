"use client";

// Screen registry: maps ScreenId → component + tab title.

import type { ComponentType } from "react";
import type { ScreenId } from "@/lib/commands";
import MarketsScreen from "./MarketsScreen";
import SecurityScreen from "./SecurityScreen";
import ChartScreen from "./ChartScreen";
import OptionsScreen from "./OptionsScreen";
import PortfolioScreen from "./PortfolioScreen";
import WatchlistScreen from "./WatchlistScreen";
import NewsScreen from "./NewsScreen";
import ScreenerScreen from "./ScreenerScreen";
import EconomyScreen from "./EconomyScreen";
import AlertsScreen from "./AlertsScreen";
import AssistantScreen from "./AssistantScreen";
import HelpScreen from "./HelpScreen";

export interface ScreenProps {
  symbol?: string;
}

export const SCREENS: Record<ScreenId, ComponentType<ScreenProps>> = {
  markets: MarketsScreen,
  security: SecurityScreen,
  chart: ChartScreen,
  options: OptionsScreen,
  portfolio: PortfolioScreen,
  watchlist: WatchlistScreen,
  news: NewsScreen,
  screener: ScreenerScreen,
  economy: EconomyScreen,
  alerts: AlertsScreen,
  assistant: AssistantScreen,
  help: HelpScreen,
};

const TITLES: Record<ScreenId, string> = {
  markets: "MARKETS",
  security: "DES",
  chart: "CHART",
  options: "OPTIONS",
  portfolio: "PORTFOLIO",
  watchlist: "WATCHLIST",
  news: "NEWS",
  screener: "SCREENER",
  economy: "ECONOMY",
  alerts: "ALERTS",
  assistant: "AI",
  help: "HELP",
};

export function screenTitle(screen: ScreenId, symbol?: string): string {
  const base = TITLES[screen];
  return symbol ? `${symbol} ${base}` : base;
}
