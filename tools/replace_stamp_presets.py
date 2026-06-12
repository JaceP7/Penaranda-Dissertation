"""Install a newly-exported stamp_presets.js into the wayfinding-app source tree.

USAGE
    python tools/replace_stamp_presets.py <path-to-downloaded-stamp_presets.js>

If the path is omitted, defaults to ~/Downloads/stamp_presets.js (the
default download target from the Export Stamps button in the app).

Mirrors tools/replace_floor_presets.py for the stamp bundle.
"""
import argparse
import difflib
import os
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT     = Path(__file__).resolve().parent.parent
TARGET_PATH   = REPO_ROOT / "wayfinding-app" / "js" / "stamp_presets.js"
DEFAULT_INPUT = Path.home() / "Downloads" / "stamp_presets.js"


def parse_version(content: str):
    m = re.search(r"STAMP_PRESETS_VERSION\s*=\s*(\d+)", content)
    return int(m.group(1)) if m else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", nargs="?", default=str(DEFAULT_INPUT),
                        help=f"Path to the downloaded file (default: {DEFAULT_INPUT})")
    parser.add_argument("--no-backup", action="store_true",
                        help="Skip writing a .bak copy of the existing stamp_presets.js")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()

    print("=" * 64)
    print("  replace_stamp_presets.py")
    print("=" * 64)
    print(f"  Input:  {input_path}")
    print(f"  Target: {TARGET_PATH}")
    print()

    if not input_path.exists():
        print(f"  ERROR: input file does not exist: {input_path}", file=sys.stderr)
        return 1

    new_content = input_path.read_text(encoding="utf-8")
    if "STAMP_PRESETS_VERSION" not in new_content or "STAMP_PLACEMENTS_BUNDLED" not in new_content:
        print("  ERROR: input doesn't look like stamp_presets.js.", file=sys.stderr)
        return 1

    new_ver = parse_version(new_content)
    if new_ver is None:
        print("  ERROR: could not extract STAMP_PRESETS_VERSION from input.", file=sys.stderr)
        return 1

    print(f"  Input version:  v{new_ver}")
    placement_count = new_content.count('"id":')
    print(f"  Placements:     ~{placement_count} (rough count)")
    print()

    if not TARGET_PATH.exists():
        print(f"  ! target doesn't exist yet — writing fresh file.")
        old_content, old_ver = "", None
    else:
        old_content = TARGET_PATH.read_text(encoding="utf-8")
        old_ver = parse_version(old_content)
        print(f"  Current target version: v{old_ver}")

    if old_ver is not None and new_ver is not None and new_ver <= old_ver:
        print(f"  ! new version (v{new_ver}) is not higher than current (v{old_ver}).", file=sys.stderr)
        print("    Devices may not pick up the change — version didn't bump.", file=sys.stderr)
        choice = input("  Proceed anyway? [y/N] ").strip().lower()
        if choice != "y":
            print("  Aborted.")
            return 1

    if not args.no_backup and TARGET_PATH.exists():
        bak = TARGET_PATH.with_suffix(".js.bak")
        shutil.copy(TARGET_PATH, bak)
        print(f"  Backup: {bak}")

    TARGET_PATH.write_text(new_content, encoding="utf-8", newline="\n")
    print(f"  Wrote new stamp_presets.js ({len(new_content):,} chars)")
    print()

    diff_lines = list(difflib.unified_diff(old_content.splitlines(), new_content.splitlines(), n=0))
    add_count = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
    rem_count = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))
    print(f"  Diff: +{add_count} / -{rem_count} lines")
    for d in diff_lines:
        if "STAMP_PRESETS_VERSION" in d:
            print(f"    {d}")
    print()
    print("Suggested next steps:")
    print()
    print(f"  cd {REPO_ROOT}")
    print( "  git diff wayfinding-app/js/stamp_presets.js | head -50")
    print( "  git add wayfinding-app/js/stamp_presets.js")
    print(f"  git commit -m 'Update stamps (presets v{old_ver}->v{new_ver})'")
    print( "  git push origin main")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
