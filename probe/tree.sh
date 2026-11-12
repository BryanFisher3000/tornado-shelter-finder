#!/bin/bash
# One-off: prints every devicectl command, three levels deep, with its one-line description.
walk() {
  local depth=$1; shift
  xcrun devicectl "$@" --help 2>/dev/null </dev/null | awk '/SUBCOMMANDS:$/{f=1;next} /^[A-Z][A-Z ]*:$/{f=0} f' | grep -E '^  [a-z][A-Za-z0-9-]*( |$)' | while read -r name rest; do
    [ "$name" = help ] && continue
    echo "devicectl${*:+ $*} $name :: $rest"
    if [ "$depth" -lt 3 ]; then walk $((depth + 1)) "$@" "$name" </dev/null; fi
  done
}
walk 1
