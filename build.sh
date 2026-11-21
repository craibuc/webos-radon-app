#!/bin/sh
# Package src/ into dist/<id>_<version>_all.ipk with LG's ares-package (npm i -g @webos-tools/cli).
# Run it from anywhere; extra arguments are passed to ares-package (-c validates without packaging, -o <dir> changes the
# output folder, -e <pattern> excludes files). Note: this ares-package version minifies JS and has no switch to turn that
# off, so the code on the TV differs from src/; debug readable code in a desktop browser first. The id and version
# come from src/appinfo.json (bump the version for every install so the TV treats it as an update).
# Output goes to dist/ (git-ignored). Install with: ares-install --device lgtv dist/<file>.ipk
cd "$(dirname "$0")" && ares-package src -o dist "$@"
