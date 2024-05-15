'use strict';

import * as core from '@actions/core'
import * as io from '@actions/io'
import * as ioUtil from '@actions/io/lib/io-util'
import * as path from 'path'
import * as utils from "./utils"

let githubWorkspacePath: string

async function installGitRemoteHg(dir: string) {
    const repoPath = `${dir}/git-remote-hg`

    const tools = ["git-remote-hg", "git-hg-helper"]
    for (const tool of tools) {
        const srcPath = `${repoPath}/${tool}`
        const dstPath = `/usr/local/bin/${tool}`
        await io.cp(srcPath, dstPath, {recursive: false, force: false})
    }
}

async function doHgClone(hgURL: string, repoPath: string, gitPath: string, gitURL: string, bookmarks: string[]) {
    await utils.execOut(gitPath, ['init', '-b', bookmarks[0], repoPath], false, githubWorkspacePath)

    await utils.execOut(gitPath, ['config', 'remote-hg.track-branches', 'false'], false, repoPath)
    await utils.execOut(gitPath, ['config', 'remote-hg.shared-marks', 'true'], false, repoPath)
    await utils.execOut(gitPath, ['config', 'remote-hg.remove-username-quotes', 'false'], false, repoPath)
    await utils.execOut(gitPath, ['config', 'core.notesRef', 'refs/notes/hg'], false, repoPath)

    await utils.execOut(gitPath, ['remote', 'add', 'origin', `hg::${hgURL}`], false, repoPath)

    await utils.execOut(gitPath, ['remote', 'add', 'github', gitURL], false, repoPath)
    await utils.execOut(gitPath, ['config', '--add', 'remote.github.fetch', '+refs/notes/*:refs/notes/*'], false, repoPath)
    await utils.execOut(gitPath, ['config', '--add', 'remote.github.push', 'refs/notes/*:refs/notes/*'], false, repoPath)
    await utils.execOut(gitPath, ['config', '--add', 'remote.github.push', 'refs/heads/*:refs/heads/*'], false, repoPath)
}

async function updateBookmarks(gitPath: string, repoPath: string, bookmarks: string[]) {
    await utils.execOut(gitPath, ['fetch', 'origin'], false, repoPath)
    await utils.execOut(gitPath, ['fetch', 'origin', '--tags'], false, repoPath)

    let rv
    for (const bookmark of bookmarks) {
        rv = await utils.exec(gitPath, ['rev-parse', bookmark], false, repoPath)
        if (rv.success) {
            await utils.execOut(gitPath, ['checkout', bookmark], false, repoPath)
            await utils.execOut(gitPath, ['pull', 'origin', bookmark], false, repoPath)
        } else {
            await utils.execOut(gitPath, ['branch', '--track', bookmark, `origin/${bookmark}`], false, repoPath)
        }

        if (await ioUtil.exists(`${repoPath}/.git/refs/remotes/github/${bookmark}`)) {
            await utils.execOut(gitPath, ['checkout', bookmark], false, repoPath)
            await utils.execOut(gitPath, ['pull', 'github', bookmark], false, repoPath)
        }
    }
}

async function mirrorHgRepo(repoDir: string, hgURL: string, hgBookmarks: string, gitURL: string, forcePush: boolean) {
    const gitPath = await io.which('git', true)
    const bookmarks = hgBookmarks.split(" ")

    let doClone = true

    const repoPath = path.resolve(
        githubWorkspacePath,
        repoDir
    )
    if (
        !(repoPath + path.sep).startsWith(
            githubWorkspacePath + path.sep
        )
    ) {
        throw new Error(
            `Repository path '${repoPath}' is not under '${githubWorkspacePath}'`
        )
    }

    if (await ioUtil.exists(repoPath)) {
        if (await ioUtil.isDirectory(repoPath) && await ioUtil.isDirectory(`${repoPath}/.git`)) {
            doClone = false
        } else {
            await io.rmRF(repoPath)
        }
    }
    if (doClone) {
        try {
            await doHgClone(hgURL, repoPath, gitPath, gitURL, bookmarks)
        } catch (err) {
            throw new Error(`Unable to clone ${hgURL}: ${err}`)
        }
    }
    await updateBookmarks(gitPath, repoPath, bookmarks)

    await utils.execOut(gitPath, ['gc', '--aggressive'], false, repoPath)

    const extraArgs = []
    if (forcePush) {
        extraArgs.push('--force')
    }
    for (const bookmark of bookmarks) {
        await utils.execOut(gitPath, ['push', 'github', bookmark].concat(extraArgs), false, repoPath)
    }
    await utils.execOut(gitPath, ['push', gitURL, '--all'].concat(extraArgs), false, repoPath)
    await utils.execOut(gitPath, ['push', gitURL, '--tags'].concat(extraArgs), false, repoPath)

    const hash = await utils.execOut(gitPath, ['rev-parse', 'HEAD'].concat(extraArgs), false, repoPath)
    core.setOutput("git-rev", hash)
}

async function main() {
    const _githubWorkspacePath = process.env['GITHUB_WORKSPACE']
    if (!_githubWorkspacePath) {
        throw new Error('GITHUB_WORKSPACE not defined')
    }
    githubWorkspacePath = path.resolve(_githubWorkspacePath as string)
    core.debug(`GITHUB_WORKSPACE = '${githubWorkspacePath}'`)

    const hgRepoURL = core.getInput('source-hg-repo-url', {required: true})
    const hgSourceBookmarks = core.getInput('source-hg-bookmarks', {required: true})
    const gitDomain = 'github.com'
    const gitScheme = 'https'
    const gitRepoOwner = core.getInput('destination-git-repo-owner', {required: true})
    const gitRepoName = core.getInput('destination-git-repo-name', {required: true})
    const forcePush = core.getBooleanInput('force-push', {required: false})
    const repoDir = core.getInput('path', {required: true})

    const gitToken = core.getInput('destination-git-personal-token', { required: true })
    core.setSecret(gitToken)

    const reValidStrInput = /^[-a-zA-Z0-9_:\/\.@ ]+$/
    const checkInputs = {
        'source-hg-repo-url': hgRepoURL,
        'source-hg-bookmarks': hgSourceBookmarks,
        'destination-git-domain': gitDomain,
        'destination-git-repo-owner': gitRepoOwner,
        'destination-git-repo-name': gitRepoName,
        'destination-git-personal-token': gitToken,
        'path': repoDir,
    }
    let invalid = false
    Object.entries(checkInputs).forEach(function (v) {
        if (!reValidStrInput.test(v[1])) {
            core.setFailed(`${v[0]}: invalid input`)
            invalid = true
        }
    })
    if (invalid) {
        return
    }

    const gitRepoURL = `${gitScheme}://${gitRepoOwner}:${gitToken}@${gitDomain}/${gitRepoOwner}/${gitRepoName}.git`

    await installGitRemoteHg(githubWorkspacePath)
    await mirrorHgRepo(repoDir, hgRepoURL, hgSourceBookmarks, gitRepoURL, forcePush)
}

main()
