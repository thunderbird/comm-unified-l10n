# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""
Transforms for adding appropriate scopes to scriptworker tasks.
"""


import functools

from gecko_taskgraph.util.scriptworker import BALROG_SERVER_SCOPES, get_scope_from_project

from comm_taskgraph.util.taskgraph_attributes import BALROG_SCOPE_ALIAS_TO_PROJECT

get_balrog_server_scope = functools.partial(
    get_scope_from_project,
    alias_to_project_map=BALROG_SCOPE_ALIAS_TO_PROJECT,
    alias_to_scope_map=BALROG_SERVER_SCOPES,
)


def add_balrog_scopes(config, jobs):
    for job in jobs:
        server_scope = get_balrog_server_scope(config)
        job["scopes"] = [server_scope]

        yield job
