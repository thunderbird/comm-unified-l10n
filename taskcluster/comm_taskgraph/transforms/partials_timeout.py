# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""
Thunderbird modifications to partial update building
"""
import logging

from taskgraph.transforms.base import TransformSequence

logger = logging.getLogger(__name__)

transforms = TransformSequence()


@transforms.add
def increase_max_run_time(config, tasks):
    # If no balrog release history, then don't run
    if not config.params.get("release_history"):
        return

    for task in tasks:
        task["worker"]["max-run-time"] = 4800

        yield task
