import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import animate from 'tailwindcss-animate';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0B0D',
        elev: '#161618',
        elev2: '#1E1E21',
        line: 'rgba(255, 255, 255, 0.10)',
        line2: 'rgba(255, 255, 255, 0.06)',
        text: '#FFFFFF',
        dim: 'rgba(255, 255, 255, 0.58)',
        faint: 'rgba(255, 255, 255, 0.40)',
        ghost: 'rgba(255, 255, 255, 0.26)',
        acc: '#B5A6FF',
        'acc-soft': '#C9BEFF',
        'acc-dim': 'rgba(181, 166, 255, 0.16)',
        'on-acc': '#16132B',
      },
      fontFamily: {
        bricolage: ['"Bricolage Grotesque"', 'sans-serif'],
        hanken: ['"Hanken Grotesk"', 'sans-serif'],
      },
      borderRadius: {
        btn: '14px',
        field: '14px',
        card: '20px',
        sheet: '26px',
      },
      spacing: {
        btn: '52px',
      },
      fontSize: {
        label: ['12px', { fontWeight: '700', letterSpacing: '0.04em' }],
      },
      brightness: {
        hover: '1.07',
      },
      scale: {
        active: '0.975',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [forms, animate],
};

export default config;
