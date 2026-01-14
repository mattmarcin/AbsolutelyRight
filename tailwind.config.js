/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'surface': {
          '0': '#1e1e2e',
          '1': '#313244',
          '2': '#45475a',
        },
        'text': {
          'primary': '#cdd6f4',
          'secondary': '#a6adc8',
          'muted': '#6c7086',
        },
        'accent': {
          'blue': '#89b4fa',
          'green': '#a6e3a1',
          'yellow': '#f9e2af',
          'red': '#f38ba8',
          'purple': '#cba6f7',
        },
      },
    },
  },
  plugins: [],
}
