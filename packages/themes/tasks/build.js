/**
 * Copyright IBM Corp. 2015, 2018
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

require('core-js/features/array/flat-map');

const { reporter } = require('@carbon/cli-reporter');
const { types: t, generate } = require('@carbon/scss-generator');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const { formatTokenName, themes, tokens } = require('../lib');

const { colors: tokenColors } = tokens;
const FILE_BANNER = t.Comment(` Code generated by @carbon/themes. DO NOT EDIT.

 Copyright IBM Corp. 2018, 2018

 This source code is licensed under the Apache-2.0 license found in the
 LICENSE file in the root directory of this source tree.
`);
const SCSS_DIR = path.resolve(__dirname, '../scss');
const METADATA_FILE = path.resolve(__dirname, '../metadata.yml');
const MIXINS_ENTRYPOINT = path.join(SCSS_DIR, '_mixins.scss');
const TOKENS_ENTRYPOINT = path.join(SCSS_DIR, '_tokens.scss');
const MAPS_ENTRYPOINT = path.join(SCSS_DIR, '_theme-maps.scss');

const defaultTheme = 'white';
const defaultThemeMapName = 'carbon--theme';

async function build() {
  reporter.info('Building scss files for themes...');

  const metadata = transformMetadata(
    yaml.safeLoad(fs.readFileSync(METADATA_FILE, 'utf8'))
  );

  // Create maps for each theme:
  // $carbon--theme--name: (
  //   token-name: token-value
  // ) !default;
  const themeMaps = Object.keys(themes).flatMap(name => {
    const theme = themes[name];
    const comment = t.Comment(`/ Carbon's ${name} color theme
/ @type Map
/ @access public
/ @group @carbon/themes`);
    const variable = t.Assignment({
      id: t.Identifier(`carbon--theme--${name}`),
      init: t.SassMap({
        properties: Object.keys(theme).map(token =>
          t.SassMapProperty(
            t.Identifier(formatTokenName(token)),
            t.SassColor(theme[token])
          )
        ),
      }),
      default: true,
    });
    return [comment, variable];
  });

  // Create carbon--theme mixin, takes a theme as input and assigns all theme
  // variables using the `!global` flag before resetting at the end of the
  // function block
  const themeMixin = [
    t.Comment(`/ Define theme variables from a map of tokens
/ @access public
/ @param {Map} $theme [$${defaultThemeMapName}] - Map of theme tokens
/ @content Pass in your custom declaration blocks to be used after the token maps set theming variables.
/
/ @example scss
/   // Default usage
/   @include carbon--theme();
/
/   // Alternate styling (not white theme)
/   @include carbon--theme($carbon--theme--g90) {
/     // declarations...
/   }
/
/   // Inline styling
/   @include carbon--theme($carbon--theme--g90) {
/     .my-dark-theme {
/       // declarations...
/     }
/   }
/
/ @group @carbon/themes`),
    t.SassMixin({
      id: t.Identifier('carbon--theme'),
      params: [
        t.AssignmentPattern({
          left: t.Identifier('theme'),
          right: t.Identifier(defaultThemeMapName),
        }),
      ],
      body: t.BlockStatement({
        body: [
          ...tokenColors.map(token => {
            const name = formatTokenName(token);

            return t.Assignment({
              id: t.Identifier(name),
              init: t.CallExpression({
                callee: t.Identifier('map-get'),
                arguments: [t.Identifier('theme'), t.SassString(name)],
              }),
              global: true,
            });
          }),
          t.AtContent(),
          t.Comment(' Reset to default theme after apply in content'),
          t.IfStatement({
            test: t.LogicalExpression({
              left: t.Identifier('theme'),
              operator: '!=',
              right: t.Identifier(defaultThemeMapName),
            }),
            consequent: t.BlockStatement([
              t.SassMixinCall(t.Identifier('carbon--theme')),
            ]),
          }),
        ],
      }),
    }),
  ];

  const mixinsFile = t.StyleSheet([
    FILE_BANNER,
    t.SassImport('./theme-maps'),
    ...themeMixin,
  ]);

  const tokensFile = t.StyleSheet([
    FILE_BANNER,
    t.SassImport('./theme-maps'),
    ...tokenColors.flatMap(token => {
      const name = formatTokenName(token);
      const tokenData =
        (metadata.tokens &&
          metadata.tokens.find(tok => {
            return tok.name === token;
          })) ||
        {};

      return [
        tokenData.role && t.Comment(`/ ${tokenData.role.join('; ')}`),
        t.Comment(`/ @type Color
/ @access public
/ @group @carbon/themes`),
        tokenData.alias && t.Comment(`/ @alias ${tokenData.alias}`),
        tokenData.deprecated && t.Comment(`/ @deprecated`),
        t.Assignment({
          id: t.Identifier(name),
          init: t.CallExpression({
            callee: t.Identifier('map-get'),
            arguments: [t.Identifier(defaultThemeMapName), t.SassString(name)],
          }),
          default: true,
        }),
      ].filter(Boolean);
    }),
  ]);

  const themeMapsFile = t.StyleSheet([
    FILE_BANNER,
    ...themeMaps,
    t.Comment(`/ Carbon's default theme
/ @type Map
/ @access public
/ @alias carbon--theme--${defaultTheme}
/ @group @carbon/themes`),
    t.Assignment({
      id: t.Identifier(defaultThemeMapName),
      init: t.Identifier(`carbon--theme--${defaultTheme}`),
      default: true,
    }),
  ]);

  await fs.ensureDir(SCSS_DIR);
  await fs.writeFile(TOKENS_ENTRYPOINT, generate(tokensFile).code);
  await fs.writeFile(MIXINS_ENTRYPOINT, generate(mixinsFile).code);
  await fs.writeFile(MAPS_ENTRYPOINT, generate(themeMapsFile).code);

  reporter.success('Done! 🎉');
}

build().catch(error => {
  console.error(error);
});

/**
 * Transform token names to formats expected by Sassdoc for descriptions and
 * aliases
 * @param {Object} - token metadata
 * @return {Object} token metadata
 */
function transformMetadata(metadata) {
  const namesRegEx = new RegExp(
    metadata.tokens.map(token => token.name).join('|'),
    'g'
  );

  const replaceMap = {};
  metadata.tokens.map(token => {
    replaceMap[token.name] = formatTokenName(token.name);
  });

  metadata.tokens.forEach((token, i) => {
    // interactive01 to `$interactive-01`
    if (token.role) {
      token.role.forEach((role, j) => {
        metadata.tokens[i].role[j] = role.replace(namesRegEx, match => {
          return '`$' + replaceMap[match] + '`';
        });
      });
    }

    // brand01 to brand-01
    if (token.alias) {
      token.alias = formatTokenName(token.alias);
    }
  });

  return metadata;
}
