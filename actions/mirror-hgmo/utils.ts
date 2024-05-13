'use strict';

import * as actionsExec from '@actions/exec';
import { ExecOptions } from '@actions/exec';
import * as io from "@actions/io";

export async function exec(command: string, args: string[], silent: boolean, cwd: string) {
    let stdout = '';
    let stderr = '';

    const options: ExecOptions = {
        silent: silent,
        ignoreReturnCode: true
    };
    if (cwd !== '') {
        options.cwd = cwd;
    }
    options.listeners = {
        stdout: (data: Buffer) => {
            stdout += data.toString();
        },
        stderr: (data: Buffer) => {
            stderr += data.toString();
        }
    };

    const returnCode: number = await actionsExec.exec(command, args, options);

    return {
        success: returnCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
    };
}

export async function execOut(command: string, args: string[], silent: boolean, cwd: string) {
    return await exec(command, args, silent, cwd).then(function (ret) {
        if (ret.stderr != '' && !ret.success) {
            throw new Error(ret.stderr + '\n\n' + ret.stdout);
        }
        return ret.stdout.trim();
    });
}

class GitCommandManager {
    private gitEnv = {
    GIT_TERMINAL_PROMPT: '0', // Disable git prompt
    GCM_INTERACTIVE: 'Never' // Disable prompting for git credential manager
    }
    private gitPath = ''

    private constructor() {}

    static async createCommandManager(): Promise<GitCommandManager> {
        const result = new GitCommandManager();
        await result.initializeCommandManager();
        return result;
    }

    private async initializeCommandManager(): Promise<void> {
        this.gitPath = await io.which('git', true);
    }

    async execGit(args: string[], silent: boolean, cwd: string) {
        return await execOut(this.gitPath, args, silent, cwd);
    }

}
