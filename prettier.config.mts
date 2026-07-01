import type { Config } from 'prettier';
import type { PluginOptions as PluginTailwindOptions } from 'prettier-plugin-tailwindcss';

const prettierConfig: Config = {
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'es5',
  jsxSingleQuote: true,
  bracketSpacing: true,
  semi: true,
  quoteProps: 'as-needed',
  bracketSameLine: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',
  proseWrap: 'always',
  plugins: ['prettier-plugin-tailwindcss'],
};

const prettierPluginTailwindConfig: PluginTailwindOptions = {
  tailwindStylesheet: './src/index.css',
};

const config = {
  ...prettierConfig,
  ...prettierPluginTailwindConfig,
};

export default config;
