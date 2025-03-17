#!/bin/bash
set -e
set -x
time tsx src/findAllSw.ts --in-dir ~/Downloads/s --out-dir /media/azq2/backup2/fw --cache-dir ~/fw-cache
