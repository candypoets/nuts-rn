/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.js', './src/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
