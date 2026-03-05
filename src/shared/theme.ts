/** Centralized color palette for the TUI */
export const THEME = {
  primary: '#00d4ff',
  success: '#00ff88',
  error: '#ff4444',
  warning: '#ffaa00',
  info: '#00aaff',

  border: '#333333',
  divider: '#333333',

  text: '#cccccc',
  textSecondary: '#888888',
  textDim: '#aaaaaa',
  textMuted: '#666666',
  textDimmer: '#555555',
  textDarkest: '#444444',

  /** Banner gradient colors (top to bottom) */
  bannerGradient: ['#00d4ff', '#00b8e6', '#009dcc', '#0081b3', '#006699'] as const,
} as const;
