# Thunderbird
Thunderbird is a powerful and customizable open source email client with many users. It is based on the same platform that Firefox uses.

## Getting Started
This README will try and give you the basics that you need to get started, more comprehensive documentation is available on the [Thunderbird Developer Website](https://developer.thunderbird.net).

### Mozilla Code Base
Thunderbird is built on the Mozilla platform, the same base that Firefox is built from. As such, the two projects share a lot of code and much of the documentation for one will apply to the other.

In order to be able to build Thunderbird - you will need the [Firefox repository](https://github.com/mozilla-firefox/firefox) as well as the [Thunderbird repository](https://github.com/thunderbird/thunderbird-desktop) (where this README lives). Check out our [Getting Started documentation](https://developer.thunderbird.net/thunderbird-development/getting-started) for instructions on how and where to get the source code.

### Firefox vs Thunderbird Source Code
The Firefox repository contains the Firefox codebase and all of the platform code. The Thunderbird repository is added as a subdirectory "comm/" under Firefox. This contains the code for Thunderbird.

## Building Thunderbird

### Build Prerequisites

This README assumes that you already have the prerequisite software required to build Thunderbird. If you have not already done so, please complete the instructions for your operating system and then continue following this guide:

- [Windows Build Prerequisites](https://developer.thunderbird.net/thunderbird-development/building-thunderbird/windows-build-prerequisites)
- [Linux Build Prerequisites](https://developer.thunderbird.net/thunderbird-development/building-thunderbird/linux-build-prerequisites)
- [macOS Build Prerequisites](https://developer.thunderbird.net/thunderbird-development/building-thunderbird/macos-build-prerequisites)

### Build Configuration

To build Thunderbird, you need to create a file named `mozconfig` (can also be `.mozconfig`) to the root directory of the mozilla-central checkout that contains the option `comm/mail` enabled. You can create a file with this line by doing this in the root source directory:

```text
echo 'ac_add_options --enable-project=comm/mail' > mozconfig
```

**If you omit this line, the build system will build Firefox instead**. Other build configuration options can be added to this file, although it's **strongly recommended** that you only use options that you fully understand. For example, to create a debug build instead of a release build, that file would also contain the line:

```text
ac_add_options --enable-debug
```

_Each of these ac\_add\_options entries needs to be on its own line._

For more on configuration options, see the page [Configuring build options](https://developer.mozilla.org/en/Configuring_Build_Options). Note that if you use an MOZ\_OBJDIR it cannot be a sibling folder to the root source directory. Use an absolute path to be sure!

### Building

**Before you start**, make sure that the version you checked out is not busted. For `hg` tip, you should see green Bs on [https://treeherder.mozilla.org/\#/jobs?repo=comm-central](https://treeherder.mozilla.org/#/jobs?repo=comm-central)

To start the build, cd into the root source directory, and run:

```text
./mach build
```

mach is our command-line tool to streamline common developer tasks. See the [mach](https://developer.mozilla.org/en-US/docs/Mozilla/Developer_guide/mach) article for more.

Building can take a significant amount of time, depending on your system, OS, and chosen build options. Linux builds on a fast box may take under _15 minutes_, but Windows builds on a slow box may take _several hours_.

### Make Your Build Faster

Follow this guide to rely on `ccache` and other [Tips for making builds faster](../getting-started.md).

## Running Thunderbird

To run your build, you can use:

```text
./mach run
```

There are various command line parameters you can add, e.g. to specify a profile, such as: -no-remote -P testing --purgecaches

Various temporary files, libraries, and the Thunderbird executable will be found in your object directory \(under `comm-central/`\), which is prefixed with `obj-`. The exact name depends on your system and OS. For example, a Mac user may get an object directory name of `obj-x86_64-apple-darwin10.7.3/`.

The Thunderbird executable in particular, and its dependencies are located under the `dist/bin` folder under the object directory. To run the executable from your `comm-central` working directory:

* Windows: `obj-.../dist/bin/thunderbird.exe`
* Linux: `obj-.../dist/bin/thunderbird`
* macOS: `obj-.../dist/Daily.app/Contents/MacOS/thunderbird`

## Update and Build Again

To pull down the latest changes, in the mozilla directory run the following commands:

```text
hg pull -u
cd comm
hg pull -u
cd ..
```

or to do it via one command:

```text
hg pull -u && cd comm && hg pull -u
```

The just run the `./mach build` command detailed in the [Building](./#building)instructions above. This will only recompile files that changed, but it may still take a long time.

## Rebuilding

To build after changes you can simply run:

```text
./mach build
```

### Rebuilding Specific Parts

If you have made many changes, but only want to rebuild specific parts, you may run the following commands.

#### C or C++ Files:

```text
./mach build binaries
```

#### JavaScript or XUL Files \(Windows Only\):

```text
./mach build path/to/dir
```


Replace `path/to/dir` with the directory with the files changed.

This is the tricky bit since you need to specify the directory that installs the files, which may be a parent directory of the changed file's directory. For example, to just rebuild the Lightning calendar extension:

```text
./mach build comm/calendar/lightning
```


## Contributing

### Getting Plugged into the Community

We have a complete listing of the ways in which you can get involved with Thunderbird [on our website](https://thunderbird.net/participate). Below are some quick references from that page that you can use if you are looking to contribute to Thunderbird core right away.

#### Mailing Lists

If you want to participate in discussions about Thunderbird development, there are two main mailing lists you want to join.

1. [**Thunderbird Planning**](https://thunderbird.topicbox.com/groups/planning)**:** This moderated mailing list is for higher level topics like: the future of Thunderbird, potential features, and changes that you would like to see happen. It is also used to discuss a variety of broader issues around community and governance of the project.
2. [**Thunderbird Developers**](https://thunderbird.topicbox.com/groups/developers)**:** A moderated mailing list for discussing engineering plans for Thunderbird. It is a place where you can raise questions and ideas for core Thunderbird development.

#### Matrix Chat
If you want to ask questions about how to hack on Thunderbird, the Matrix room you want to join is [\#maildev:mozilla.org](https://matrix.to/#/#maildev:mozilla.org?web-instance%5Belement.io%5D=chat.mozilla.org).

If you want to ask questions about how to hack on Thunderbird, the IRC channel you want to join is [\#maildev on irc.mozilla.org](irc://irc.mozilla.org/maildev).

### Report a Bug and Request Features

Feature requests should be submitted to [Mozilla Connect](https://connect.mozilla.org/).

Thunderbird uses bugzilla for reporting and tracking bugs as well as enhancement requests. If you want to become a contributor to Thunderbird, you will need an account on Bugzilla.

### Fixing a Bug and Submitting Patches
See [Fixing a Bug in the developer documentation](https://developer.thunderbird.net/thunderbird-development/fixing-a-bug).
