"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var matrixcs = _interopRequireWildcard(require("./matrix.js"));
Object.keys(matrixcs).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === matrixcs[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return matrixcs[key];
    }
  });
});
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

if (globalThis.__js_sdk_entrypoint) {
  throw new Error("Multiple matrix-js-sdk entrypoints detected!");
}
globalThis.__js_sdk_entrypoint = true;

// just *accessing* indexedDB throws an exception in firefox with indexeddb disabled.
let indexedDB;
try {
  indexedDB = globalThis.indexedDB;
} catch {}

// if our browser (appears to) support indexeddb, use an indexeddb crypto store.
if (indexedDB) {
  matrixcs.setCryptoStoreFactory(() => new matrixcs.IndexedDBCryptoStore(indexedDB, "matrix-js-sdk:crypto"));
}
globalThis.matrixcs = matrixcs;