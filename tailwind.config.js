/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Cairo"', '"Tajawal"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe7fe',
          200: '#bfd4fe',
          300: '#93b7fc',
          400: '#6091f8',
          500: '#3b6ef0',
          600: '#264fe4',
          700: '#1f3dcf',
          800: '#1f34a7',
          900: '#1e2f83',
        },
        surface: {
          50: '#f7f8fa',
          100: '#eef0f3',
          200: '#dfe3e8',
        },
      },
    },
  },
  plugins: [],
};
