/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        nastaliq: ['"Noto Nastaliq Urdu"', '"Jameel Noori Nastaleeq"', 'serif'],
        gulzar: ['"Gulzar"', '"Noto Nastaliq Urdu"', 'serif'],
        naskh: ['"Noto Naskh Arabic"', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },
    },
  },
  plugins: [],
};
