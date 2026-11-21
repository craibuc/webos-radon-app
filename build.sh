#!/bin/sh
# Package src/ into dist/<id>_<version>_all.ipk
cd "$(dirname "$0")" && ares-package src -o dist "$@"
