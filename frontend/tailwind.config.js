/** @type {import('tailwindcss').Config} */
// Палитра берётся из src/theme.js, чтобы цвета жили в одном месте.
const { colors } = require('./src/theme');

module.exports = {
  content: ['./App.js', './src/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: { colors },
  },
  plugins: [],
};
