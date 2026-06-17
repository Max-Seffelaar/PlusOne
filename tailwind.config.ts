import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';
import animate from 'tailwindcss-animate';

const config = {
  darkMode: ['class'],
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
        display: ['var(--font-display)', 'Bricolage Grotesque', ...defaultTheme.fontFamily.sans],
        body: ['var(--font-body)', 'Hanken Grotesk', ...defaultTheme.fontFamily.sans],
        sans: ['var(--font-body)', 'Hanken Grotesk', ...defaultTheme.fontFamily.sans],
      },
      fontSize: {
        label: ['12px', { lineHeight: '1.4', fontWeight: '700', letterSpacing: '0.04em' }],
      },
      borderRadius: {
        btn: '14px',
        field: '14px',
        card: '20px',
        sheet: '26px',
      },
      animation: {
        'entrance-up': 'entranceUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        entranceUp: {
          from: {
            transform: 'translateY(24px)',
            opacity: '1',
          },
          to: {
            transform: 'translateY(0)',
            opacity: '1',
          },
        },
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
