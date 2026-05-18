// Shared palette for the RLN testing surface. Centralised so a single
// edit re-themes every tab; mirrors the dark theme from the prior
// RgbLightningScreen.tsx.

export const colors = {
  background: '#121212',
  primary: '#FF6501',
  text: '#fff',
  textSecondary: '#999',
  textTertiary: '#666',
  card: '#1E1E1E',
  cardElevated: '#262626',
  border: '#333',
  borderSubtle: '#262626',
  success: '#4CAF50',
  danger: '#FF3B30',
  warning: '#FF9500',
  error: '#FF6B6B',
  info: '#4FC3F7',
  blocked: '#9C27B0'
} as const
