export default {
  darkMode: 'class',
  content: ['../../packages/ui/src/**/*.{ts,tsx}', '../../apps/*/src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { brand: '#7c5cff', mint: '#5eead4' },
    fontFamily: { sans: ['Inter', 'sans-serif'], display: ['Manrope', 'Inter', 'sans-serif'] }
  } },
  plugins: []
};
