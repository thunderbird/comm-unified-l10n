/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const path = require("path");
const mozilla = require("eslint-plugin-mozilla");
const fs = require("fs");

function readFile(filePath) {
  return fs
    .readFileSync(filePath, { encoding: "utf-8" })
    .split("\n")
    .filter(p => p && !p.startsWith("#"))
    .map(p => p.replace(/^comm\//, ""));
}

const ignorePatterns = [
  ...readFile(path.join(__dirname, "tools", "lint", "ThirdPartyPaths.txt")),
  ...readFile(path.join(__dirname, "tools", "lint", "Generated.txt")),
];

const xpcshellTestPaths = [
  "**/test*/unit*/",
  "**/test*/xpcshell/",
  "chat/**/test*/",
];

const browserTestPaths = [
  "**/test*/**/browser/",
  "mail/base/test/performance/",
  "mail/base/test/webextensions/",
  "mail/base/test/widgets/",
  "mail/test/static/",
];

module.exports = {
  settings: {
    "import/extensions": [".mjs"],
    // To avoid bad interactions of the html plugin with the xml preprocessor in
    // eslint-plugin-mozilla, we turn off processing of the html plugin for .xml
    // files.
    "html/xml-extensions": [".xhtml"],
    jsdoc: {
      tagNamePreference: {
        attr: "attribute",
        cssprop: "cssproperty",
        tag: "tagname",
      },
    },
  },
  // Ignore eslint configurations in parent directories.
  root: true,
  env: {
    es2024: true,
  },
  ignorePatterns,

  // We would like the same base rules as provided by
  // mozilla/tools/lint/eslint/eslint-plugin-mozilla/lib/configs/recommended.js
  extends: [
    "plugin:mozilla/recommended",
    "plugin:json/recommended-with-comments-legacy",
    "prettier",
  ],

  // When adding items to this file please check for effects on sub-directories.
  plugins: ["mozilla", "html", "import", "json", "promise"],

  rules: {
    complexity: ["error", 80],
    "func-names": ["error", "never"],
    "mozilla/prefer-boolean-length-check": "off",
    // Enforce using `let` only when variables are reassigned.
    "prefer-const": ["error", { destructuring: "all" }],
  },

  overrides: [
    {
      files: ["*.*"],
      // The browser environment is not available for system modules, sjs, workers
      // or any of the xpcshell-test files.
      excludedFiles: [
        "*.sys.mjs",
        "*.sjs",
        "**/?(*.)worker.?(m)js",
        ...xpcshellTestPaths.map(filePath => `${filePath}**`),
      ],
      env: {
        browser: true,
      },
    },
    {
      files: ["*.*"],
      env: {
        "mozilla/privileged": true,
        "mozilla/specific": true,
      },
      rules: {
        // Require braces around blocks that start a new line. This must be
        // configured after eslint-config-prettier is included (via `extends`
        // above), as otherwise that configuration disables it. Hence, we do
        // not include it in
        // `tools/lint/eslint/eslint-plugin-mozilla/lib/configs/recommended.js`.
        curly: ["error", "all"],
      },
    },
    {
      files: [".eslintrc.js"],
      env: {
        node: true,
        browser: false,
      },
    },
    {
      files: ["**/test/**", "**/tests/**"],
      extends: ["plugin:mozilla/general-test"],
    },
    {
      files: ["*.mjs"],
      rules: {
        "import/default": "error",
        "import/export": "error",
        "import/named": "error",
        "import/namespace": "error",
        "import/newline-after-import": "error",
        "import/no-duplicates": "error",
        "import/no-absolute-path": "error",
        "import/no-named-default": "error",
        "import/no-named-as-default": "error",
        "import/no-named-as-default-member": "error",
        "import/no-self-import": "error",
        "import/no-unassigned-import": "error",
        "import/no-unresolved": [
          "error",
          // Bug 1773473 - Ignore resolver URLs for chrome and resource as we
          // do not yet have a resolver for them.
          { ignore: ["chrome://", "resource://"] },
        ],
        "import/no-useless-path-segments": "error",
      },
    },
    {
      files: ["mail/components/storybook/**"],
      rules: {
        "import/no-unresolved": "off",
      },
    },
    {
      ...mozilla.configs["xpcshell-test"],
      files: xpcshellTestPaths.map(filePath => `${filePath}**`),
      rules: {
        ...mozilla.configs["xpcshell-test"].rules,
        "func-names": "off",
      },
      excludedFiles: ["**/*.mjs", "**/*.sjs"],
    },
    {
      // If it is a test head file, we turn off global unused variable checks, as it
      // would require searching the other test files to know if they are used or not.
      // This would be expensive and slow, and it isn't worth it for head files.
      // We could get developers to declare as exported, but that doesn't seem worth it.
      files: [
        ...browserTestPaths.map(filePath => `${filePath}head*.js`),
        ...xpcshellTestPaths.map(filePath => `${filePath}head*.js`),
      ],
      rules: {
        "no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            vars: "local",
          },
        ],
      },
    },
    {
      ...mozilla.configs["browser-test"],
      files: browserTestPaths.map(filePath => `${filePath}**`),
      rules: {
        ...mozilla.configs["browser-test"].rules,
        "func-names": "off",
      },
      excludedFiles: ["**/*.mjs", "**/*.sjs"],
    },
    {
      files: ["*.*"],
      excludedFiles: [".eslintrc.js"],
      extends: ["plugin:mozilla/valid-jsdoc"],
      rules: {
        "jsdoc/check-tag-names": [
          "error",
          {
            definedTags: [
              "attribute",
              "cssproperty",
              "part",
              "slot",
              "tagname",
            ],
          },
        ],
      },
    },
  ],
};
