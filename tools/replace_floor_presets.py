"""Install a newly-exported floor_presets.js into the wayfinding-app source tree.

USAGE
    python tools/replace_floor_presets.py <path-to-downloaded-floor_presets.js>

If the path is omitted, defaults to ~/Downloads/floor_presets.js (the
default download target from the Export Floors button in the app).

The script:
  1. Validates the input file is a sensible floor_presets.js export.
  2. Backs up the existing wayfinding-app/js/floor_presets.js.
  3. Copies the new file into place.
  4. Prints a unified diff of the version line + a line-count summary.
  5. Prints suggested git commands.

Nothing is committed — review the diff yourself, then run git add / commit / push.
"""
import argparse
import difflib
import os
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT      = Path(__file__).resolve().parent.parent
TARGET_PATH    = REPO_ROOT / "wayfinding-app" / "js" / "floor_presets.js"
DEFAULT_INPUT  = Path.home() / "Downloads" / "floor_presets.js"


def err(msg: str) -> None:
    print(f"\033[31mERROR:\033[0m {msg}", file=sys.stderr)


def ok(msg: str) -> None:
    print(f"\033[32m✓\033[0m {msg}")


def warn(msg: str) -> None:
    print(f"\033[33m!\033[0m {msg}")


def info(msg: str) -> None:
    print(f"  {msg}")


def parse_version(content: str):
    """Extract FLOOR_PRESETS_VERSION and the count of cells per floor from content."""
    ver_match = re.search(r"FLOOR_PRESETS_VERSION\s*=\s*(\d+)", content)
    ver = int(ver_match.group(1)) if ver_match else None

    grid_match = re.search(r"FLOOR_PRESETS_GRID_SIZE\s*=\s*(\d+)", content)
    grid = int(grid_match.group(1)) if grid_match else None

    # Count floors via the FLOOR_PRESETS object opening
    floor_lines = re.findall(r"^\s*(\d+)\s*:\s*\[", content, re.MULTILINE)
    floors = [int(f) for f in floor_lines]
    return ver, grid, floors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", nargs="?", default=str(DEFAULT_INPUT),
                        help=f"Path to the downloaded file (default: {DEFAULT_INPUT})")
    parser.add_argument("--no-backup", action="store_true",
                        help="Skip writing a .bak copy of the existing floor_presets.js")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()

    print("=" * 64)
    print("  replace_floor_presets.py")
    print("=" * 64)
    info(f"Input:  {input_path}")
    info(f"Target: {TARGET_PATH}")
    print()

    if not input_path.exists():
        err(f"Input file does not exist: {input_path}")
        return 1

    new_content = input_path.read_text(encoding="utf-8")
    if "FLOOR_PRESETS_VERSION" not in new_content or "FLOOR_PRESETS" not in new_content:
        err("Input doesn't look like a floor_presets.js — missing FLOOR_PRESETS_VERSION or FLOOR_PRESETS.")
        return 1

    new_ver, new_grid, new_floors = parse_version(new_content)
    if new_ver is None:
        err("Could not extract FLOOR_PRESETS_VERSION from input.")
        return 1

    ok(f"Input version:  v{new_ver}")
    info(f"Grid size:      {new_grid}")
    info(f"Floors:         {len(new_floors)}  (keys: {new_floors})")
    print()

    if not TARGET_PATH.exists():
        warn(f"Target doesn't exist yet — writing new file.")
        old_content = ""
        old_ver = None
    else:
        old_content = TARGET_PATH.read_text(encoding="utf-8")
        old_ver, _, _ = parse_version(old_content)
        info(f"Current target version: v{old_ver}")

    if old_ver is not None and new_ver is not None and new_ver <= old_ver:
        warn(f"New version (v{new_ver}) is not higher than current (v{old_ver}).")
        warn("Devices may not pick up the change because the version didn't bump.")
        choice = input("  Proceed anyway? [y/N] ").strip().lower()
        if choice != "y":
            info("Aborted.")
            return 1

    # Backup
    if not args.no_backup and TARGET_PATH.exists():
        bak = TARGET_PATH.with_suffix(".js.bak")
        shutil.copy(TARGET_PATH, bak)
        ok(f"Backup: {bak}")

    # Write
    TARGET_PATH.write_text(new_content, encoding="utf-8")
    ok(f"Wrote new floor_presets.js ({len(new_content):,} chars)")
    print()

    # Show condensed diff stats (full diff would be huge)
    old_lines = old_content.splitlines()
    new_lines = new_content.splitlines()
    diff_lines = list(difflib.unified_diff(old_lines, new_lines, n=0))
    add_count = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
    rem_count = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))
    info(f"Diff: +{add_count} / -{rem_count} lines")
    print()

    # Print version-line diff specifically (most useful)
    for d in diff_lines:
        if "FLOOR_PRESETS_VERSION" in d:
            print(f"  {d}")
    print()

    # Suggested git commands
    print("Suggested next steps:")
    print()
    print(f"  cd {REPO_ROOT}")
    print( "  git diff wayfinding-app/js/floor_presets.js | head -50")
    print(f"  git add wayfinding-app/js/floor_presets.js")
    print(f"  git commit -m 'Update floor plans (presets v{old_ver}->v{new_ver})'")
    print(f"  git push origin main")
    print()
    print("Then wait ~60s for Vercel to deploy. All users will see the new")
    print("layout on next page load — the version bump invalidates their")
    print("cached localStorage automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
