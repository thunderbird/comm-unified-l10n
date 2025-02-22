/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* notice that these valuse are octal. */
const PERM_IRWXU = 0o700; /* read, write, execute/search by owner */
const PERM_IRUSR = 0o400; /* read permission, owner */
const PERM_IWUSR = 0o200; /* write permission, owner */
const PERM_IXUSR = 0o100; /* execute/search permission, owner */
const PERM_IRWXG = 0o070; /* read, write, execute/search by group */
const PERM_IRGRP = 0o040; /* read permission, group */
const PERM_IWGRP = 0o020; /* write permission, group */
const PERM_IXGRP = 0o010; /* execute/search permission, group */
const PERM_IRWXO = 0o007; /* read, write, execute/search by others */
const PERM_IROTH = 0o004; /* read permission, others */
const PERM_IWOTH = 0o002; /* write permission, others */
const PERM_IXOTH = 0o001; /* execute/search permission, others */

const MODE_RDONLY = 0x01;
const MODE_WRONLY = 0x02;
const MODE_RDWR = 0x04;
const MODE_CREATE = 0x08;
const MODE_APPEND = 0x10;
const MODE_TRUNCATE = 0x20;
const MODE_SYNC = 0x40;
const MODE_EXCL = 0x80;

var futils = new Object();

futils.umask = PERM_IWOTH | PERM_IWGRP;
futils.lastSaveAsDir = null;
futils.lastOpenDir = null;

/**
 * Internal function used by |pickSaveAs|, |pickOpen| and |pickGetFolder|.
 *
 * @param initialPath (*defaultDir* in |pick| functions) Sets the
 *                    initial directory for the dialog. The user may browse
 *                    to any other directory - it does not restrict anything.
 * @param typeList Optional. An |Array| or space-separated string of allowed
 *                 file types for the dialog. An item in the array may be a
 *                 string (used as title and filter) or a two-element array
 *                 (title and filter, respectively); when using a string,
 *                 the following standard filters may be used: |$all|, |$html|,
 *                 |$text|, |$images|, |$xml|, |$xul|, |$noAll| (prevents "All
 *                 Files" filter being included).
 * @param defaultString Optional. Sets the initial/default filename.
 * @returns An |Object| with |ok| (Boolean), |file| (|nsIFile|) and
 *          |picker| (|nsIFilePicker|) properties.
 */
futils.getPicker = function futils_nosepicker(
  initialPath,
  typeList,
  defaultString
) {
  let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  if (defaultString) {
    picker.defaultString = defaultString;
  }

  if (initialPath) {
    picker.displayDirectory = returnFile(initialPath);
  }

  let includeAll = true;
  if (!typeList) {
    typeList = [];
  }

  for (let type of typeList) {
    switch (type[0]) {
      case "$all":
        picker.appendFilters(Ci.nsIFilePicker.filterAll);
        includeAll = false;
        break;

      case "$noAll":
        includeAll = false;
        break;

      case "$html":
        picker.appendFilters(Ci.nsIFilePicker.filterHTML);
        break;

      case "$text":
        picker.appendFilters(Ci.nsIFilePicker.filterText);
        break;

      case "$images":
        picker.appendFilters(Ci.nsIFilePicker.filterImages);
        break;

      case "$xml":
        picker.appendFilters(Ci.nsIFilePicker.filterXML);
        break;

      case "$xul":
        picker.appendFilters(Ci.nsIFilePicker.filterXUL);
        break;

      default:
        /* type should always be a pair but check anyway. */
        let extns = type.length > 1 ? type[1] : "*.*";
        picker.appendFilter(type[0], extns);
        break;
    }
  }

  if (includeAll) {
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
  }

  return picker;
};

function getPickerChoice(picker) {
  var obj = new Object();
  obj.picker = picker;
  obj.ok = false;
  obj.file = null;

  try {
    obj.reason = picker.show();
  } catch (ex) {
    dd("caught exception from file picker: " + ex);
    return obj;
  }

  if (obj.reason != Ci.nsIFilePicker.returnCancel) {
    obj.file = picker.file;
    obj.ok = true;
  }

  return obj;
}

/**
 * Displays a standard file save dialog.
 *
 * @param title Optional. The title for the dialog.
 * @param typeList Optional. See |futils.getPicker| for details.
 * @param defaultFile Optional. See |futils.getPicker| for details.
 * @returns An |Object| with "ok" (Boolean), "file" (|nsIFile|) and
 *          "picker" (|nsIFilePicker|) properties.
 */
function pickSaveAs(title, typeList, defaultFile) {
  let picker = futils.getPicker(futils.lastSaveAsDir, typeList, defaultFile);
  picker.init(window, title, Ci.nsIFilePicker.modeSave);

  var rv = getPickerChoice(picker);
  if (rv.ok) {
    futils.lastSaveAsDir = picker.file.parent;
  }

  return rv;
}

/**
 * Displays a standard file open dialog.
 *
 * @param title Optional. The title for the dialog.
 * @param typeList Optional. See |futils.getPicker| for details.
 * @returns An |Object| with "ok" (Boolean), "file" (|nsIFile|) and
 *          "picker" (|nsIFilePicker|) properties.
 */
function pickOpen(title, typeList) {
  let picker = futils.getPicker(futils.lastOpenDir, typeList);
  picker.init(window, title, Ci.nsIFilePicker.modeOpen);

  var rv = getPickerChoice(picker);
  if (rv.ok) {
    futils.lastOpenDir = picker.file.parent;
  }

  return rv;
}

/**
 * Displays a standard directory selection dialog.
 *
 * @param title Optional. The title for the dialog.
 * @param defaultDir Optional. See |futils.getPicker| for details.
 * @returns An |Object| with "ok" (Boolean), "file" (|nsIFile|) and
 *          "picker" (|nsIFilePicker|) properties.
 */
function pickGetFolder(title, defaultDir) {
  let picker = futils.getPicker(defaultDir ? defaultDir : futils.lastOpenDir);
  picker.init(window, title, Ci.nsIFilePicker.modeGetFolder);

  var rv = getPickerChoice(picker);
  if (rv.ok) {
    futils.lastOpenDir = picker.file;
  }

  return rv;
}

function mkdir(localFile) {
  localFile.create(Ci.nsIFile.DIRECTORY_TYPE, 0o766 & ~futils.umask);
}

function getTempFile(path, name) {
  var tempFile = new nsLocalFile(path);
  tempFile.append(name);
  tempFile.createUnique(0, 0o600);
  return tempFile;
}

function nsLocalFile(path) {
  let localFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  localFile.initWithPath(path);
  return localFile;
}

function returnFile(file) {
  if (typeof file == "string") {
    return new nsLocalFile(file);
  }
  if (isinstance(file, Ci.nsIFile)) {
    return file;
  }
  throw "bad type for argument |file|.";
}

function LocalFile(file, mode) {
  let perms = 0o666 & ~futils.umask;

  if (typeof mode == "string") {
    switch (mode) {
      case ">":
        mode = MODE_WRONLY | MODE_CREATE | MODE_TRUNCATE;
        break;
      case ">>":
        mode = MODE_WRONLY | MODE_CREATE | MODE_APPEND;
        break;
      case "<":
        mode = MODE_RDONLY;
        break;
      default:
        throw "Invalid mode ``" + mode + "''";
    }
  }

  this.localFile = returnFile(file);
  this.path = this.localFile.path;

  if (mode & (MODE_WRONLY | MODE_RDWR)) {
    this.outputStream = Cc[
      "@mozilla.org/network/file-output-stream;1"
    ].createInstance(Ci.nsIFileOutputStream);
    this.outputStream.init(this.localFile, mode, perms, 0);
  }

  if (mode & (MODE_RDONLY | MODE_RDWR)) {
    this.baseInputStream = Cc[
      "@mozilla.org/network/file-input-stream;1"
    ].createInstance(Ci.nsIFileInputStream);
    this.baseInputStream.init(this.localFile, mode, perms, 0);
    this.inputStream = Cc[
      "@mozilla.org/scriptableinputstream;1"
    ].createInstance(Ci.nsIScriptableInputStream);
    this.inputStream.init(this.baseInputStream);
  }
}

LocalFile.prototype.write = function fo_write(buf) {
  if (!("outputStream" in this)) {
    throw "file not open for writing.";
  }

  return this.outputStream.write(buf, buf.length);
};

// Will return null if there is no more data in the file.
// Will block until it has some data to return.
// Will return an empty string if there is data, but it couldn't be read.
LocalFile.prototype.read = function fo_read(max) {
  if (!("inputStream" in this)) {
    throw "file not open for reading.";
  }

  if (typeof max == "undefined") {
    max = this.inputStream.available();
  }

  try {
    var rv = this.inputStream.read(max);
    return rv != "" ? rv : null;
  } catch (ex) {
    return "";
  }
};

LocalFile.prototype.close = function fo_close() {
  if ("outputStream" in this) {
    this.outputStream.close();
  }
  if ("inputStream" in this) {
    this.inputStream.close();
  }
};

LocalFile.prototype.flush = function fo_close() {
  return this.outputStream.flush();
};
