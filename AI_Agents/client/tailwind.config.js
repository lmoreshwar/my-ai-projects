/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "app-red": "#E60012",
        "app-dark-red": "#b7000c",
        "app-blue": "#004098",
        "app-dark-blue": "#002d6b",
        "on-surface": "#1a1a1a",
        "on-surface-variant": "#434654",
        "surface-container-high": "#f0f0f0",
        "surface-container-low": "#f8f8f8",
        "surface-container": "#f5f5f5",
        "surface-container-lowest": "#ffffff",
        "surface-container-highest": "#e0e0e0",
        "surface-variant": "#eeeeee",
        "outline-variant": "#d1d1d1",
        "outline": "#737685",
        "secondary": "#555555",
        "error": "#ba1a1a",
        "background": "#ffffff",
      },
      fontFamily: {
        headline: ["Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        label: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}

