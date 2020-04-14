#!/usr/bin/env python

"""
Release script for botan (https://botan.randombit.net/)

This script requires Python 2.7 or 3.6

(C) 2011,2012,2013,2015,2016,2017 Jack Lloyd

Botan is released under the Simplified BSD License (see license.txt)
"""

import datetime
import errno
import hashlib
import io
import logging
import optparse # pylint: disable=deprecated-module
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
import traceback

# This is horrible, but there is no way to override tarfile's use of time.time
# in setting the gzip header timestamp, which breaks deterministic archives

GZIP_HEADER_TIME = 0

def fake_time():
    return GZIP_HEADER_TIME
time.time = fake_time


def check_subprocess_results(subproc, name):
    (raw_stdout, raw_stderr) = subproc.communicate()

    stderr = raw_stderr.decode('utf-8')

    if subproc.returncode != 0:
        stdout = raw_stdout.decode('utf-8')
        if stdout != '':
            logging.error(stdout)
        if stderr != '':
            logging.error(stderr)
        raise Exception('Running %s failed' % (name))

    if stderr != '':
        logging.warning(stderr)

    return raw_stdout

def run_git(args):
    cmd = ['git'] + args
    logging.debug('Running %s' % (' '.join(cmd)))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return check_subprocess_results(proc, 'git')

def maybe_gpg(val):
    val = val.decode('ascii')
    if 'BEGIN PGP SIGNATURE' in val:
        return val.split('\n')[-2]
    else:
        return val.strip()

def rel_time_to_epoch(year, month, day, hour, minute, second):
    dt = datetime.datetime(year, month, day, hour, minute, second)
    return (dt - datetime.datetime(1970, 1, 1)).total_seconds()

def datestamp(tag):
    ts = maybe_gpg(run_git(['show', '--no-patch', '--format=%ai', tag]))

    ts_matcher = re.compile(r'^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) .*')

    logging.debug('Git returned timestamp of %s for tag %s' % (ts, tag))
    match = ts_matcher.match(ts)

    if match is None:
        logging.error('Failed parsing timestamp "%s" of tag %s' % (ts, tag))
        return 0

    rel_date = int(match.group(1) + match.group(2) + match.group(3))
    rel_epoch = rel_time_to_epoch(*[int(match.group(i)) for i in range(1, 7)])

    return rel_date, rel_epoch

def revision_of(tag):
    return maybe_gpg(run_git(['show', '--no-patch', '--format=%H', tag]))

def extract_revision(revision, to):
    tar_val = run_git(['archive', '--format=tar', '--prefix=%s/' % (to), revision])
    tar_f = tarfile.open(fileobj=io.BytesIO(tar_val))
    tar_f.extractall()

def gpg_sign(keyid, passphrase_file, files, detached=True):

    options = ['--armor', '--detach-sign'] if detached else ['--clearsign']

    gpg_cmd = ['gpg', '--batch'] + options + ['--local-user', keyid]
    if passphrase_file is not None:
        gpg_cmd[1:1] = ['--passphrase-file', passphrase_file]

    for filename in files:
        logging.info('Signing %s using PGP id %s' % (filename, keyid))

        cmd = gpg_cmd + [filename]

        logging.debug('Running %s' % (' '.join(cmd)))

        gpg = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE)

        check_subprocess_results(gpg, 'gpg')

    return [filename + '.asc' for filename in files]

def parse_args(args):
    parser = optparse.OptionParser(
        "usage: %prog [options] <version tag>\n" +
        "       %prog [options] snapshot <branch>"
        )

    parser.add_option('--verbose', action='store_true',
                      default=False, help='Extra debug output')

    parser.add_option('--quiet', action='store_true',
                      default=False, help='Only show errors')

    parser.add_option('--output-dir', metavar='DIR', default='.',
                      help='Where to place output (default %default)')

    parser.add_option('--print-output-names', action='store_true',
                      help='Print output archive filenames to stdout')

    parser.add_option('--archive-types', metavar='LIST', default='txz',
                      help='Set archive types to generate (default %default)')

    parser.add_option('--pgp-key-id', metavar='KEYID',
                      default='EFBADFBC',
                      help='PGP signing key (default %default, "none" to disable)')

    parser.add_option('--pgp-passphrase-file', metavar='FILE',
                      default=None,
                      help='PGP signing key passphrase file')

    parser.add_option('--write-hash-file', metavar='FILE', default=None,
                      help='Write a file with checksums')

    return parser.parse_args(args)

def remove_file_if_exists(fspath):
    try:
        os.unlink(fspath)
    except OSError as e:
        if e.errno != errno.ENOENT:
            raise

def rewrite_version_file(version_file, target_version, snapshot_branch, rev_id, rel_date):

    if snapshot_branch:
        assert target_version == snapshot_branch

    version_file_name = os.path.basename(version_file)

    contents = open(version_file).readlines()

    version_re = re.compile('release_(major|minor|patch) = ([0-9]+)')

    def content_rewriter():
        for line in contents:

            if not snapshot_branch:
                # Verify the version set in the source matches the tag
                match = version_re.match(line)
                if match:
                    name_to_idx = {
                        'major': 0,
                        'minor': 1,
                        'patch': 2
                    }
                    version_parts = target_version.split('.')
                    assert len(version_parts) == 3
                    in_tag = int(version_parts[name_to_idx[match.group(1)]])
                    in_file = int(match.group(2))

                    if in_tag != in_file:
                        raise Exception('Version number part "%s" in %s does not match tag %s' %
                                        (match.group(1), version_file_name, target_version))

            if line == 'release_vc_rev = None\n':
                yield 'release_vc_rev = \'git:%s\'\n' % (rev_id)
            elif line == 'release_datestamp = 0\n':
                yield 'release_datestamp = %d\n' % (rel_date)
            elif line == "release_type = \'unreleased\'\n":
                if target_version == snapshot_branch:
                    yield "release_type = 'snapshot:%s'\n" % (snapshot_branch)
                else:
                    yield "release_type = 'release'\n"
            else:
                yield line

    open(version_file, 'w').write(''.join(list(content_rewriter())))

def write_archive(output_basename, archive_type, rel_epoch, all_files, hash_file):

    def archive_suffix(archive_type):
        if archive_type == 'tgz':
            return 'tgz'
        elif archive_type == 'tbz':
            return 'tar.bz2'
        elif archive_type == 'txz':
            return 'tar.xz'
        elif archive_type == 'tar':
            return 'tar'
        else:
            raise Exception("Unknown archive type '%s'" % (archive_type))

    output_archive = output_basename + '.' + archive_suffix(archive_type)
    logging.info('Writing archive "%s"' % (output_archive))

    remove_file_if_exists(output_archive)
    remove_file_if_exists(output_archive + '.asc')

    def write_mode(archive_type):
        if archive_type == 'tgz':
            return 'w:gz'
        elif archive_type == 'tbz':
            return 'w:bz2'
        elif archive_type == 'txz':
            return 'w:xz'
        elif archive_type == 'tar':
            return 'w'
        else:
            raise Exception("Unknown archive type '%s'" % (archive_type))

    # gzip format embeds the original filename, tarfile.py does the wrong
    # thing unless the output name ends in .gz. So pass an explicit
    # fileobj in that case, and supply a name in the form tarfile expects.
    if archive_type == 'tgz':
        archive = tarfile.open(output_basename + '.tar.gz',
                               write_mode(archive_type),
                               fileobj=open(output_archive, 'wb'))
    else:
        archive = tarfile.open(output_basename + '.tar',
                               write_mode(archive_type),
                               fileobj=open(output_archive, 'wb'))

    for f in all_files:
        tarinfo = archive.gettarinfo(f)
        tarinfo.uid = 500
        tarinfo.gid = 500
        tarinfo.uname = "botan"
        tarinfo.gname = "botan"
        tarinfo.mtime = rel_epoch
        archive.addfile(tarinfo, open(f, 'rb'))
    archive.close()

    archive_contents = open(output_archive, 'rb').read()

    sha256 = hashlib.new('sha256')
    sha256.update(archive_contents)
    archive_hash = sha256.hexdigest().upper()

    logging.info('%s is %.2f MiB' % (output_archive, len(archive_contents) / (1024.0*1024.0)))
    logging.info('SHA-256(%s) = %s' % (output_archive, archive_hash))
    if hash_file is not None:
        hash_file.write("%s  %s\n" % (archive_hash, output_archive))

    return output_archive

def configure_logging(options):
    class ExitOnErrorLogHandler(logging.StreamHandler, object):
        def emit(self, record):
            super(ExitOnErrorLogHandler, self).emit(record)
            # Exit script if and ERROR or worse occurred
            if record.levelno >= logging.ERROR:
                if sys.exc_info()[2] is not None:
                    logging.info(traceback.format_exc())
                sys.exit(1)

    def log_level():
        if options.verbose:
            return logging.DEBUG
        if options.quiet:
            return logging.ERROR
        return logging.INFO

    lh = ExitOnErrorLogHandler(sys.stderr)
    lh.setFormatter(logging.Formatter('%(levelname) 7s: %(message)s'))
    logging.getLogger().addHandler(lh)
    logging.getLogger().setLevel(log_level())

def main(args=None):
    # pylint: disable=too-many-branches,too-many-locals,too-many-statements
    if args is None:
        args = sys.argv[1:]

    (options, args) = parse_args(args)

    configure_logging(options)

    if len(args) != 1 and len(args) != 2:
        logging.error('Usage: %s [options] <version tag>' % (sys.argv[0]))

    snapshot_branch = None
    target_version = None

    archives = options.archive_types.split(',') if options.archive_types != '' else []
    for archive_type in archives:
        if archive_type not in ['tar', 'tgz', 'tbz', 'txz']:
            logging.error('Unknown archive type "%s"' % (archive_type))

    if args[0] == 'snapshot':
        if len(args) != 2:
            logging.error('Missing branch name for snapshot command')
        snapshot_branch = args[1]
    else:
        if len(args) != 1:
            logging.error('Usage error, try --help')
        target_version = args[0]

    if snapshot_branch:
        logging.info('Creating snapshot release from branch %s', snapshot_branch)
        target_version = snapshot_branch
    elif len(args) == 1:
        try:
            logging.info('Creating release for version %s' % (target_version))

            (major, minor, patch) = [int(x) for x in target_version.split('.')]

            assert target_version == '%d.%d.%d' % (major, minor, patch)
        except ValueError as e:
            logging.error('Invalid version number %s' % (target_version))

    rev_id = revision_of(target_version)
    if rev_id == '':
        logging.error('No tag matching %s found' % (target_version))

    rel_date, rel_epoch = datestamp(target_version)
    if rel_date == 0 or rel_epoch == 0:
        logging.error('No date found for version, git error?')

    logging.info('Found %s at revision id %s released %d' % (target_version, rev_id, rel_date))

    global GZIP_HEADER_TIME # pylint: disable=global-statement
    GZIP_HEADER_TIME = rel_epoch

    def output_name():
        if snapshot_branch:
            if snapshot_branch == 'master':
                return 'Botan-snapshot-%s' % (rel_date)
            else:
                return 'Botan-snapshot-%s-%s' % (snapshot_branch, rel_date)
        else:
            return 'Botan-' + target_version

    output_basename = output_name()

    logging.debug('Output basename %s' % (output_basename))

    if os.access(output_basename, os.X_OK):
        logging.info('Removing existing output dir %s' % (output_basename))
        shutil.rmtree(output_basename)

    extract_revision(rev_id, output_basename)

    all_files = []
    for (curdir, _, files) in os.walk(output_basename):
        all_files += [os.path.join(curdir, f) for f in files]
    all_files.sort(key=lambda f: (os.path.dirname(f), os.path.basename(f)))

    def find_version_file():

        # location of file with version information has moved over time
        for possible_version_file in ['src/build-data/version.txt', 'version.txt', 'botan_version.py']:
            full_path = os.path.join(output_basename, possible_version_file)
            if os.access(full_path, os.R_OK):
                return full_path

        logging.error('Cannot locate version file')
        return None

    version_file = find_version_file()

    if not os.access(version_file, os.R_OK):
        logging.error('Cannot read %s' % (version_file))

    rewrite_version_file(version_file, target_version, snapshot_branch, rev_id, rel_date)

    try:
        os.makedirs(options.output_dir)
    except OSError as e:
        if e.errno != errno.EEXIST:
            logging.error('Creating dir %s failed %s' % (options.output_dir, e))

    output_files = []

    hash_file = None
    if options.write_hash_file is not None:
        hash_file = open(options.write_hash_file, 'w')

    for archive_type in archives:
        output_files.append(write_archive(output_basename, archive_type, rel_epoch, all_files, hash_file))

    if hash_file is not None:
        hash_file.close()

    shutil.rmtree(output_basename)

    if options.pgp_key_id != 'none':
        if options.write_hash_file is not None:
            output_files += gpg_sign(options.pgp_key_id, options.pgp_passphrase_file,
                                     [options.write_hash_file], False)
        else:
            output_files += gpg_sign(options.pgp_key_id, options.pgp_passphrase_file,
                                     output_files, True)

    if options.output_dir != '.':
        for output_file in output_files:
            logging.debug('Moving %s to %s' % (output_file, options.output_dir))
            shutil.move(output_file, os.path.join(options.output_dir, output_file))

    if options.print_output_names:
        for output_file in output_files:
            print(output_file)

    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e: # pylint: disable=broad-except
        logging.info(traceback.format_exc())
        logging.error(e)
        sys.exit(1)
