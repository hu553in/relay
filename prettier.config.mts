import type { Config } from 'prettier';
import type { PluginOptions as PluginTailwindOptions } from 'prettier-plugin-tailwindcss';

const config = {
  arrowParens: 'avoid',
  bracketSameLine: false,
  bracketSpacing: true,
  endOfLine: 'lf',
  jsxSingleQuote: true,
  plugins: ['prettier-plugin-tailwindcss'],
  printWidth: 100,
  proseWrap: 'always',
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  tailwindStylesheet: './src/index.css',
  trailingComma: 'es5',
  useTabs: false,
} satisfies Config & PluginTailwindOptions;

export default config;
